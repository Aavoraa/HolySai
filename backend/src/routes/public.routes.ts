import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { many, one } from '../config/db.js';
import { env } from '../config/env.js';
import { validate, v } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import { publicApplicationStatus } from '../services/admissions-applications.service.js';
import { publicVerifyCertificate } from '../services/operations-records.service.js';

/**
 * Unauthenticated configuration for the sign-in screen and mobile app bootstrap.
 * Contains nothing personal: school branding, campus names, public settings,
 * and — outside production only — the demo account emails for the role tiles.
 */
const r = Router();

r.get('/config', async (_req: Request, res: Response) => {
  const [campuses, year, settings, stats] = await Promise.all([
    many('SELECT code, name, short_name AS "shortName", place FROM campuses WHERE is_active ORDER BY established'),
    one('SELECT label FROM academic_years WHERE is_current'),
    many('SELECT key, value FROM system_settings WHERE is_public'),
    one(`SELECT (SELECT count(*) FROM students WHERE deleted_at IS NULL AND status = 'active')::int AS students,
                (SELECT count(*) FROM employees WHERE deleted_at IS NULL AND employment_status = 'active')::int AS staff,
                (SELECT count(*) FROM campuses WHERE is_active)::int AS campuses`),
  ]);
  const data: Record<string, unknown> = {
    campuses,
    academicYear: year?.label ?? null,
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    stats,
    map: { tileUrl: env.MAP_TILE_URL, attribution: '© OpenStreetMap contributors', hasApiKey: !!env.MAP_API_KEY },
    environment: env.NODE_ENV,
  };
  if (!env.isProd) {
    data.demoAccounts = await many(
      `SELECT u.email, u.full_name AS "fullName", u.title, r.key AS role, r.name AS "roleName"
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.email LIKE '%.demo@%' AND u.deleted_at IS NULL ORDER BY array_position(
          ARRAY['principal','teacher','parent','office','staff','super_admin','school_admin','management','hr','finance','student'], r.key::text)`,
    );
  }
  return ok(res, data, 'Public configuration');
});

// Families check an admission application with its number and the phone on the form.
// Strictly rate limited per IP so application numbers cannot be guessed at speed.
const statusLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many attempts. Please try again in 15 minutes.', error: 'RATE_LIMITED' }),
  skip: () => env.isTest,
});

r.get('/application-status', statusLimiter,
  validate(z.object({ applicationNo: z.string().trim().min(4).max(30), phone: z.string().trim().min(10).max(20) }), 'query'),
  async (req: Request, res: Response) => {
    const q = v<{ applicationNo: string; phone: string }>(req, 'query');
    return ok(res, await publicApplicationStatus(q.applicationNo, q.phone), 'Application status');
  });

// Anyone holding a printed certificate can confirm it from its QR code.
r.get('/certificates/:code', statusLimiter, validate(z.object({ code: z.string().trim().regex(/^[A-Za-z]{2}-\d{4}-\d{3,6}$/, 'Not a certificate code') }), 'params'),
  async (req: Request, res: Response) => ok(res, await publicVerifyCertificate(v<{ code: string }>(req, 'params').code), 'Certificate verified'));

export default r;
