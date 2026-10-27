import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { upload } from '../services/documents.service.js';
import * as forms from '../services/admissions-forms.service.js';
import { badRequest } from '../utils/errors.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as leads from '../services/admissions.service.js';
import * as apps from '../services/admissions-applications.service.js';
import * as stats from '../services/admissions-analytics.service.js';
import * as crm from '../services/admissions-crm.service.js';
import {
  alumniListQuery, alumniSchema, alumniUpdateSchema, applicationCreateSchema, applicationFormSchema, applicationImportSchema, applicationListQuery, applicationStatusSchema,
  applicationUpdateSchema, assignSchema, campusQuery, pastDate, commListQuery, communicationSchema, docParam, documentStatusSchema,
  enrolSchema, followUpCreateSchema, followUpListQuery, followUpUpdateSchema, idParam, leadCreateSchema, leadListQuery,
  leadParam, leadUpdateSchema, partnerListQuery, partnerSchema, partnerUpdateSchema, referralCreateSchema, referralListQuery, referrerQuery,
  rewardSchema, stageChangeSchema, vendorListQuery, vendorSchema, vendorUpdateSchema, visitCreateSchema, visitListQuery,
} from '../validators/admissions.validators.js';
import { assertDecider } from '../services/approvals-guard.js';

/**
 * Admissions & CRM. Mounted at /api behind authentication.
 * Read: admissions.read (alumni/vendors/partners: crm.read). Writes: admissions.manage / crm.manage.
 */
const r = Router();
const READ = requirePermission('admissions.read');
const MANAGE = requirePermission('admissions.manage');
const CRM_READ = requirePermission('crm.read');
const CRM_MANAGE = requirePermission('crm.manage');

const campusId = (req: Request) => v<{ campusId?: string }>(req, 'query').campusId;

/** CSV of filled admission forms — held in memory, 2 MB, one file. */
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    const okType = /\.csv$/i.test(file.originalname) && ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
    if (!okType) return cb(badRequest('Upload the admission forms as a .csv file (save the spreadsheet as CSV)', 'UNSUPPORTED_FILE_TYPE'));
    cb(null, true);
  },
});
const uploadBody = z.object({
  receivedOn: pastDate.optional().or(z.literal('').transform(() => undefined)),
});

// =============================================================================
// Dashboard & analytics
// =============================================================================
r.get('/admissions/dashboard', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await stats.dashboard(campusId(req)), 'Admissions dashboard'));

r.get('/admissions/conversion', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await stats.conversion(campusId(req)), 'Conversion analytics'));

r.get('/admissions/counsellors', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await leads.counsellors(campusId(req)), 'Counsellors'));

// =============================================================================
// Leads (enquiries)
// =============================================================================
r.get('/enquiries', READ, validate(leadListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await leads.listLeads(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Leads retrieved');
});

r.get('/enquiries/summary', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await stats.enquirySummary(campusId(req)), 'Enquiry summary'));

r.get('/enquiries/pipeline', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await leads.pipeline(campusId(req)), 'Pipeline'));

r.post('/enquiries', MANAGE, validate(leadCreateSchema),
  async (req: Request, res: Response) => created(res, await leads.createLead(req, v(req)), 'Lead created'));

r.post('/enquiries/auto-assign', MANAGE, validate(campusQuery),
  async (req: Request, res: Response) => {
    const out = await leads.autoAssign(req, v(req).campusId);
    return ok(res, out, out.assigned ? `${out.assigned} lead${out.assigned === 1 ? '' : 's'} assigned` : 'Every open lead already has a counsellor');
  });

r.get('/enquiries/:id', READ, validate(leadParam, 'params'),
  async (req: Request, res: Response) => ok(res, await leads.getLead(v(req, 'params').id), 'Lead retrieved'));

r.patch('/enquiries/:id', MANAGE, validate(leadParam, 'params'), validate(leadUpdateSchema), async (req: Request, res: Response) => {
  await leads.updateLead(req, v(req, 'params').id, v(req));
  return ok(res, null, 'Lead updated');
});

r.delete('/enquiries/:id', MANAGE, validate(leadParam, 'params'), async (req: Request, res: Response) => {
  await leads.deleteLead(req, v(req, 'params').id);
  return ok(res, null, 'Lead deleted');
});

r.post('/enquiries/:id/stage', MANAGE, validate(leadParam, 'params'), validate(stageChangeSchema),
  async (req: Request, res: Response) => {
    const out = await leads.changeStage(req, v(req, 'params').id, v(req));
    return ok(res, out, `Moved to ${out.stage}`);
  });

r.post('/enquiries/:id/assign', MANAGE, validate(leadParam, 'params'), validate(assignSchema),
  async (req: Request, res: Response) => {
    const out = await leads.assignCounsellor(req, v(req, 'params').id, v(req).counsellorId);
    return ok(res, out, out.counsellor ? `Assigned to ${out.counsellor}` : 'Counsellor removed');
  });

r.post('/enquiries/:id/follow-ups', MANAGE, validate(leadParam, 'params'), validate(followUpCreateSchema),
  async (req: Request, res: Response) => created(res, await leads.addFollowUp(req, v(req, 'params').id, v(req)), 'Follow-up scheduled'));

r.post('/enquiries/:id/communications', MANAGE, validate(leadParam, 'params'), validate(communicationSchema),
  async (req: Request, res: Response) => created(res, await leads.addCommunication(req, v(req, 'params').id, v(req)), `${v(req).channel} logged`));

// =============================================================================
// Follow-ups
// =============================================================================
r.get('/follow-ups', READ, validate(followUpListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await leads.listFollowUps(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Follow-ups retrieved');
});

r.patch('/follow-ups/:id', MANAGE, validate(idParam, 'params'), validate(followUpUpdateSchema), async (req: Request, res: Response) => {
  const b = v(req);
  await leads.updateFollowUp(req, v(req, 'params').id, b);
  return ok(res, null, b.status ? `Follow-up marked ${b.status.toLowerCase()}` : 'Follow-up updated');
});

// =============================================================================
// Campus visits
// =============================================================================
r.get('/visits', READ, validate(visitListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await stats.listVisits(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Campus visits retrieved');
});

r.get('/visits/summary', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await stats.visitSummary(campusId(req)), 'Campus visit summary'));

r.post('/visits', MANAGE, validate(visitCreateSchema),
  async (req: Request, res: Response) => created(res, await stats.scheduleVisit(req, v(req)), 'Campus visit scheduled'));

// =============================================================================
// Applications
// =============================================================================
r.get('/applications', READ, validate(applicationListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await apps.listApplications(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Applications retrieved');
});

r.get('/applications/summary', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await apps.applicationSummary(campusId(req)), 'Application summary'));

r.post('/applications', MANAGE, validate(applicationCreateSchema), async (req: Request, res: Response) => {
  const out = await forms.createApplication(req, v(req));
  return created(res, out, out.leadCreated ? `Lead ${out.leadCode} and application ${out.applicationNo} created` : `Application ${out.applicationNo} opened`);
});

// ---- Admission forms: bulk import (registered before /applications/:id) ----------
r.get('/applications/import/template', MANAGE, async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="admission-forms-template.csv"');
  res.send(`﻿${forms.importTemplate()}`);
});

r.post('/applications/import', MANAGE, csvUpload.single('file'), validate(applicationImportSchema), async (req: Request, res: Response) => {
  const out = await forms.importApplications(req, req.file, v(req));
  const msg = out.dryRun
    ? `${out.valid} of ${out.rows} row${out.rows === 1 ? '' : 's'} ready to import`
    : `${out.imported} application${out.imported === 1 ? '' : 's'} imported${out.failed ? ` · ${out.failed} row${out.failed === 1 ? '' : 's'} need attention` : ''}`;
  return ok(res, out, msg);
});

r.get('/applications/:id', READ, validate(idParam, 'params'),
  async (req: Request, res: Response) => ok(res, await apps.getApplication(v(req, 'params').id), 'Application retrieved'));

// ---- Admission form: typed (manual) and uploaded (scan) -------------------------
r.get('/applications/:id/form', READ, validate(idParam, 'params'),
  async (req: Request, res: Response) => ok(res, await forms.getForm(v(req, 'params').id), 'Admission form retrieved'));

r.put('/applications/:id/form', MANAGE, validate(idParam, 'params'), validate(applicationFormSchema), async (req: Request, res: Response) => {
  const b = v(req);
  const out = await forms.saveForm(req, v(req, 'params').id, b);
  return ok(res, out, b.submit ? (out.status === 'Submitted' ? 'Admission form submitted' : 'Admission form saved') : 'Draft saved');
});

r.post('/applications/:id/form/upload', MANAGE, validate(idParam, 'params'), upload.single('file'), validate(uploadBody), async (req: Request, res: Response) => {
  const out = await forms.uploadForm(req, v(req, 'params').id, req.file, v(req).receivedOn);
  return created(res, out, out.replaced ? 'Admission form replaced' : 'Admission form uploaded');
});

r.post('/applications/:id/documents/:docId/upload', MANAGE, validate(docParam, 'params'), upload.single('file'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  return created(res, await forms.uploadChecklistDocument(req, p.id, p.docId, req.file), 'Document uploaded — awaiting verification');
});

r.get('/applications/:id/documents/:docId/download', requirePermission('admissions.read', 'documents.read'), validate(docParam, 'params'),
  async (req: Request, res: Response) => {
    const p = v(req, 'params');
    const f = await forms.openDocument(req, p.id, p.docId);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    f.stream.pipe(res);
  });

r.patch('/applications/:id', MANAGE, validate(idParam, 'params'), validate(applicationUpdateSchema), async (req: Request, res: Response) => {
  await apps.updateApplication(req, v(req, 'params').id, v(req));
  return ok(res, null, 'Application updated');
});

r.post('/applications/:id/status', MANAGE, validate(idParam, 'params'), validate(applicationStatusSchema),
  async (req: Request, res: Response) => {
    // Offer / reject are the admission decisions — Super Admin only; other moves stay with the office.
    if (['Offer Made', 'Rejected'].includes(v(req).status)) assertDecider(req.user, 'Making an offer or rejecting an application');
    const out = await apps.setStatus(req, v(req, 'params').id, v(req));
    return ok(res, out, `Application marked ${out.status}`);
  });

r.patch('/applications/:id/documents/:docId', MANAGE, validate(docParam, 'params'), validate(documentStatusSchema),
  async (req: Request, res: Response) => {
    const p = v(req, 'params');
    return ok(res, await apps.setDocumentStatus(req, p.id, p.docId, v(req).status), `Document marked ${v(req).status}`);
  });

r.post('/applications/:id/enrol', MANAGE, requirePermission('students.create'), validate(idParam, 'params'), validate(enrolSchema),
  async (req: Request, res: Response) => {
    const out = await apps.enrol(req, v(req, 'params').id, v(req));
    return created(res, out, `Enrolled — Student Master ${out.admissionNo} created`);
  });

// =============================================================================
// Parent referrals
// =============================================================================
r.get('/referrals', READ, validate(referralListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await stats.listReferrals(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Referrals retrieved');
});

r.get('/referrals/summary', READ, validate(campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await stats.referralSummary(campusId(req)), 'Referral summary'));

r.get('/referrals/referrers', MANAGE, validate(referrerQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await stats.referrerOptions(v(req, 'query').q), 'Parents'));

r.post('/referrals', MANAGE, validate(referralCreateSchema),
  async (req: Request, res: Response) => created(res, await stats.createReferral(req, v(req)), 'Referral recorded'));

r.patch('/referrals/:id/reward', MANAGE, validate(idParam, 'params'), validate(rewardSchema), async (req: Request, res: Response) => {
  await stats.setReward(req, v(req, 'params').id, v(req).rewardStatus);
  return ok(res, null, v(req).rewardStatus === 'Credited' ? 'Recognition credited' : 'Recognition marked pending');
});

// =============================================================================
// CRM — alumni, vendors, partners, communication history
// =============================================================================
r.get('/alumni', CRM_READ, validate(alumniListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await crm.listAlumni(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Alumni retrieved');
});
r.get('/alumni/summary', CRM_READ, async (_req: Request, res: Response) => ok(res, await crm.alumniSummary(), 'Alumni summary'));
r.post('/alumni', CRM_MANAGE, validate(alumniSchema), async (req: Request, res: Response) => created(res, await crm.createAlumnus(req, v(req)), 'Alumnus added'));
r.patch('/alumni/:id', CRM_MANAGE, validate(idParam, 'params'), validate(alumniUpdateSchema), async (req: Request, res: Response) => {
  await crm.updateAlumnus(req, v(req, 'params').id, v(req));
  return ok(res, null, 'Alumnus updated');
});

r.get('/vendors', CRM_READ, validate(vendorListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await crm.listVendors(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Vendors retrieved');
});
r.get('/vendors/summary', CRM_READ, async (_req: Request, res: Response) => ok(res, await crm.vendorSummary(), 'Vendor summary'));
r.post('/vendors', CRM_MANAGE, validate(vendorSchema), async (req: Request, res: Response) => created(res, await crm.createVendor(req, v(req)), 'Vendor added'));
r.patch('/vendors/:id', CRM_MANAGE, validate(idParam, 'params'), validate(vendorUpdateSchema), async (req: Request, res: Response) => {
  await crm.updateVendor(req, v(req, 'params').id, v(req));
  return ok(res, null, 'Vendor updated');
});

r.get('/partners', CRM_READ, validate(partnerListQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await crm.listPartners(f);
    return paged(res, rows, total, f.page, f.pageSize, 'Partners retrieved');
  });
r.post('/partners', CRM_MANAGE, validate(partnerSchema), async (req: Request, res: Response) => created(res, await crm.createPartner(req, v(req)), 'Partner added'));
r.patch('/partners/:id', CRM_MANAGE, validate(idParam, 'params'), validate(partnerUpdateSchema), async (req: Request, res: Response) => {
  await crm.updatePartner(req, v(req, 'params').id, v(req));
  return ok(res, null, 'Partner updated');
});

r.get('/crm/communications', requirePermission('crm.read', 'communication.read'), validate(commListQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await crm.listCommunications(f);
    return paged(res, rows, total, f.page, f.pageSize, 'Communication history');
  });

export default r;
