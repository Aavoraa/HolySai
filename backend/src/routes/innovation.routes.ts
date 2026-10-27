import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as svc from '../services/innovation.service.js';
import * as val from '../validators/innovation.validators.js';
import { assertDecider } from '../services/approvals-guard.js';

/**
 * Student Innovation Lab. Mounted at /api behind authentication.
 * Teachers are limited to projects of students in their scope (see innovation.service).
 */
const r = Router();
const READ = requirePermission('innovation.read');
const MANAGE = requirePermission('innovation.manage');
const PORTAL = requirePermission('student_portal.use');
const id = validate(val.idParam, 'params');
const pid = (req: Request) => v<{ id: string }>(req, 'params').id;

r.get('/innovation/dashboard', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.dashboard(req.user!, v(req, 'query').campusId), 'Innovation Lab dashboard'));

// ---- Ideas -------------------------------------------------------------------
r.get('/innovation/ideas', READ, validate(val.ideaListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listIdeas(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Ideas retrieved');
});
r.get('/innovation/ideas/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.ideaSummary(req.user!, v(req, 'query').campusId), 'Idea summary'));
r.post('/innovation/ideas', MANAGE, validate(val.ideaCreate), async (req: Request, res: Response) =>
  created(res, await svc.createIdea(req, v(req)), 'Idea submitted'));
r.post('/innovation/ideas/:id/review', MANAGE, id, validate(val.ideaReview), async (req: Request, res: Response) => {
  // Starting a review is preparation; accepting or declining an idea is the Super Admin's decision.
  if (v(req).action !== 'start') assertDecider(req.user, 'Accepting or declining an idea');
  const out = await svc.reviewIdea(req, pid(req), v(req));
  return ok(res, out, `Idea ${out.status.toLowerCase()}`);
});
r.post('/innovation/ideas/:id/convert', MANAGE, id, validate(val.ideaConvert), async (req: Request, res: Response) =>
  created(res, await svc.convertIdea(req, pid(req), v(req)), 'Project created from idea'));

// ---- Student portal ----------------------------------------------------------
// Self-scoped: the student comes from the access token, never from the request,
// so a student can only ever read or submit their own ideas.
r.get('/me/ideas', PORTAL, async (req: Request, res: Response) =>
  ok(res, await svc.listOwnIdeas(req.user!), 'Your ideas'));
r.post('/me/ideas', PORTAL, validate(val.selfIdeaCreate), async (req: Request, res: Response) =>
  created(res, await svc.createOwnIdea(req, v(req)), 'Idea submitted for review'));

// ---- Projects ----------------------------------------------------------------
r.get('/innovation/projects', READ, validate(val.projectListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listProjects(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Projects retrieved');
});
r.post('/innovation/projects', MANAGE, validate(val.projectCreate), async (req: Request, res: Response) =>
  created(res, await svc.createProject(req, v(req)), 'Project created'));
r.get('/innovation/projects/:id', READ, id, async (req: Request, res: Response) =>
  ok(res, await svc.getProject(req, pid(req)), 'Project retrieved'));
r.patch('/innovation/projects/:id', MANAGE, id, validate(val.projectUpdate), async (req: Request, res: Response) => {
  await svc.updateProject(req, pid(req), v(req));
  return ok(res, null, 'Project updated');
});
r.post('/innovation/projects/:id/advance', MANAGE, id, validate(val.projectAdvance), async (req: Request, res: Response) => {
  const out = await svc.advanceStage(req, pid(req), v(req));
  return ok(res, out, out.achievementId ? 'Achievement recorded on Student 360' : `Moved to ${out.status}`);
});
r.post('/innovation/projects/:id/members', MANAGE, id, validate(val.memberAdd), async (req: Request, res: Response) => {
  await svc.addMember(req, pid(req), v(req));
  return created(res, null, 'Member added');
});
r.delete('/innovation/projects/:id/members/:studentId', MANAGE, validate(val.memberParams, 'params'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  await svc.removeMember(req, p.id, p.studentId);
  return ok(res, null, 'Member removed');
});
r.post('/innovation/projects/:id/milestones', MANAGE, id, validate(val.milestoneCreate), async (req: Request, res: Response) =>
  created(res, await svc.addMilestone(req, pid(req), v(req)), 'Milestone added'));
r.post('/innovation/projects/:id/evidence', MANAGE, id, validate(val.evidenceCreate), async (req: Request, res: Response) =>
  created(res, await svc.addEvidence(req, pid(req), v(req)), 'Evidence added'));
r.delete('/innovation/evidence/:id', MANAGE, id, async (req: Request, res: Response) => {
  await svc.removeEvidence(req, pid(req));
  return ok(res, null, 'Evidence removed');
});
r.post('/innovation/projects/:id/feedback', MANAGE, id, validate(val.feedbackCreate), async (req: Request, res: Response) =>
  created(res, await svc.addFeedback(req, pid(req), v(req)), 'Feedback added'));

// ---- Milestones ----------------------------------------------------------------
r.get('/innovation/milestones', READ, validate(val.milestoneListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listMilestones(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Milestones retrieved');
});
r.get('/innovation/milestones/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.milestoneSummary(req.user!, v(req, 'query').campusId), 'Milestone summary'));
r.patch('/innovation/milestones/:id', MANAGE, id, validate(val.milestoneUpdate), async (req: Request, res: Response) => {
  await svc.updateMilestone(req, pid(req), v(req));
  return ok(res, null, 'Milestone updated');
});
r.delete('/innovation/milestones/:id', MANAGE, id, async (req: Request, res: Response) => {
  await svc.deleteMilestone(req, pid(req));
  return ok(res, null, 'Milestone deleted');
});

// ---- Mentors ---------------------------------------------------------------------
r.get('/innovation/mentors', READ, validate(val.mentorListQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.listMentors(req.user!, v(req, 'query')), 'Mentors retrieved'));
r.patch('/innovation/mentors/:id', MANAGE, id, validate(val.mentorUpdate), async (req: Request, res: Response) => {
  await svc.setMentor(req, pid(req), v(req).isMentor);
  return ok(res, null, v(req).isMentor ? 'Added to the mentor panel' : 'Removed from the mentor panel');
});

// ---- Competitions --------------------------------------------------------------------
r.get('/innovation/competitions', READ, validate(val.competitionListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listCompetitions(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Competitions retrieved');
});
r.post('/innovation/competitions', MANAGE, validate(val.competitionCreate), async (req: Request, res: Response) =>
  created(res, await svc.createCompetition(req, v(req)), 'Competition registered'));
r.put('/innovation/competitions/:id', MANAGE, id, validate(val.competitionUpdate), async (req: Request, res: Response) => {
  await svc.updateCompetition(req, pid(req), v(req));
  return ok(res, null, 'Competition updated');
});
r.post('/innovation/competitions/:id/entries', MANAGE, id, validate(val.entryCreate), async (req: Request, res: Response) => {
  await svc.addEntry(req, pid(req), v(req));
  return created(res, null, 'Project entered');
});
r.patch('/innovation/competitions/:id/entries/:projectId', MANAGE, validate(val.entryParams, 'params'), validate(val.entryUpdate),
  async (req: Request, res: Response) => {
    const p = v(req, 'params');
    await svc.updateEntry(req, p.id, p.projectId, v(req).result);
    return ok(res, null, 'Result recorded');
  });
r.delete('/innovation/competitions/:id/entries/:projectId', MANAGE, validate(val.entryParams, 'params'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  await svc.removeEntry(req, p.id, p.projectId);
  return ok(res, null, 'Entry withdrawn');
});

// ---- Achievements ------------------------------------------------------------------------
r.get('/innovation/achievements', READ, validate(val.achievementListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listAchievements(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Achievements retrieved');
});
r.get('/innovation/achievements/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.achievementSummary(req.user!, v(req, 'query').campusId), 'Achievement summary'));
r.get('/innovation/achievement-types', READ, validate(z.object({}), 'query'), async (_req: Request, res: Response) =>
  ok(res, await svc.achievementTypes(), 'Achievement types'));

export default r;
