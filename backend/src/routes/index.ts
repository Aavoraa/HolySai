import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import authRoutes from './auth.routes.js';
import publicRoutes from './public.routes.js';
import coreRoutes from './core.routes.js';
import studentRoutes from './students.routes.js';
import trackingRoutes from './tracking.routes.js';
import { assignmentRoutes, deviceIngestRoutes, deviceRoutes } from './devices.routes.js';
import parentRoutes from './parents.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import academicsRoutes from './academics.routes.js';
import admissionsRoutes from './admissions.routes.js';
import financeRoutes from './finance.routes.js';
import workforceRoutes from './workforce.routes.js';
import safetyRoutes from './safety.routes.js';
import parentsExperienceRoutes from './parents_experience.routes.js';
import operationsRoutes from './operations.routes.js';
import innovationRoutes from './innovation.routes.js';
import groupRoutes from './group.routes.js';
import intelligenceRoutes from './intelligence.routes.js';
import examCorrectionRoutes from './exam-correction.routes.js';
import planningRoutes from './planning.routes.js';
import jobCardRoutes from './jobcards.routes.js';
import parentLogRoutes from './parentlog.routes.js';
import syllabusRoutes from './syllabus.routes.js';

export const api = Router();

// ---- Public -------------------------------------------------------------
api.use('/auth', authRoutes);
api.use('/public', publicRoutes);
// GPS devices authenticate with their own device token, not a user session.
api.use('/v1', deviceIngestRoutes);

// ---- Authenticated ------------------------------------------------------
// Everything below requires a valid access token; each route additionally
// declares the permission it needs.
api.use(authenticate);
api.use('/', coreRoutes);            // notifications, tasks, search, lookups, audit, users, settings
api.use('/students', studentRoutes); // students + Student 360 + per-student location
api.use('/tracking', trackingRoutes);
api.use('/devices', deviceRoutes);
api.use('/device-assignments', assignmentRoutes);
api.use('/parents', parentRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/', academicsRoutes);
api.use('/', admissionsRoutes);
api.use('/', financeRoutes);
api.use('/', workforceRoutes);
api.use('/', safetyRoutes);
api.use('/', parentsExperienceRoutes);
api.use('/', operationsRoutes);
api.use('/', innovationRoutes);
api.use('/', groupRoutes);
api.use('/', intelligenceRoutes);
api.use('/', examCorrectionRoutes); // Paper Correction (AI answer-sheet marking, exam-vision/)
api.use('/', planningRoutes);       // budget plans + Super Admin approvals inbox
api.use('/', jobCardRoutes);        // job cards between departments
api.use('/', parentLogRoutes);      // parent & staff contact log
api.use('/', syllabusRoutes);       // Cambridge IGCSE syllabuses and grade boundaries
