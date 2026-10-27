import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as V from '../validators/academics.validators.js';
import * as core from '../services/academics.service.js';
import * as att from '../services/academics-attendance.service.js';
import * as teach from '../services/academics-teaching.service.js';
import * as asm from '../services/academics-assessments.service.js';
import * as plan from '../services/academics-planning.service.js';
import * as rep from '../services/academics-reports.service.js';
import { assertDecider } from '../services/approvals-guard.js';

/**
 * Academics domain: teacher dashboard, student attendance, curriculum,
 * classes, subjects, timetable, assessments, question bank, lesson plans,
 * homework, report cards and academic performance.
 * Mounted at /api behind authentication; every route declares a permission.
 * Section-bound data is limited to a teacher's own sections (404 otherwise).
 */
const r = Router();

const READ = requirePermission('academics.read');
const MANAGE = requirePermission('academics.manage');
const MARKS = requirePermission('assessments.manage');
const STAFF_STUDENTS = requireAny('students.read', 'students.read_assigned');
const id = validate(V.idParam, 'params');
const pid = (req: Request) => v<{ id: string }>(req, 'params').id;

// ---------------------------------------------------------------------------
// Teacher dashboard & shared pickers
// ---------------------------------------------------------------------------
r.get('/academics/teacher-dashboard', requirePermission('attendance.mark'),
  async (req: Request, res: Response) => ok(res, await teach.teacherDashboard(req.user!), 'Teacher dashboard'));

r.get('/academics/sections', requireAny('academics.read', 'attendance.read'), validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await core.listSections(req.user!, v(req, 'query').campusId), 'Sections'));

// ---------------------------------------------------------------------------
// Student attendance
// ---------------------------------------------------------------------------
r.get('/attendance/sections', requirePermission('attendance.read'), validate(V.attendanceSectionsQuery, 'query'),
  async (req: Request, res: Response) => {
    const q = v(req, 'query');
    return ok(res, await att.attendanceSections(req.user!, q.campusId, q.date ?? core.schoolToday()), 'Sections');
  });

r.get('/attendance/register', requirePermission('attendance.read'), validate(V.registerQuery, 'query'),
  async (req: Request, res: Response) => {
    const q = v(req, 'query');
    return ok(res, await att.getRegister(req.user!, q.sectionId, q.date), 'Register');
  });

r.put('/attendance/register', requirePermission('attendance.mark'), validate(V.registerSave),
  async (req: Request, res: Response) => ok(res, await att.saveRegister(req, v(req)), 'Attendance saved'));

r.get('/attendance/summary', requirePermission('attendance.read'), validate(V.attendanceSummaryQuery, 'query'),
  async (req: Request, res: Response) => {
    const q = v(req, 'query');
    return ok(res, await att.attendanceSummary(q.campusId, q.date), 'Attendance summary');
  });

r.get('/attendance/analytics', requirePermission('students.read'), validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await att.attendanceAnalytics(v(req, 'query').campusId), 'Attendance analytics'));

// ---------------------------------------------------------------------------
// Classes, subjects, curriculum, objectives
// ---------------------------------------------------------------------------
r.get('/academics/classes', READ, validate(V.classesQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await core.listClasses(req.user!, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Classes retrieved');
  });

r.get('/academics/classes/summary', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await core.classesSummary(req.user!, v(req, 'query').campusId), 'Classes summary'));

r.put('/academics/sections/:id', MANAGE, id, validate(V.sectionUpdate),
  async (req: Request, res: Response) => ok(res, await core.updateSection(req, pid(req), v(req)), 'Section updated'));

r.get('/academics/subjects', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await core.listSubjects(v(req, 'query').campusId), 'Subjects'));

r.get('/academics/curriculum', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await core.curriculumOverview(v(req, 'query').campusId), 'Curriculum'));

r.get('/academics/objectives', READ, validate(V.objectivesQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await core.listObjectives(f);
    return paged(res, rows, total, f.page, f.pageSize, 'Objectives retrieved');
  });

r.get('/academics/objectives/stages', READ,
  async (_req: Request, res: Response) => ok(res, await core.objectiveStages(), 'Objective stages'));

r.post('/academics/objectives', MANAGE, validate(V.objectiveCreate),
  async (req: Request, res: Response) => created(res, await core.createObjective(req, v(req)), 'Objective added'));

r.post('/academics/objectives/import', MANAGE, validate(V.objectiveImport),
  async (req: Request, res: Response) => created(res, await core.importObjectives(req, v(req).rows), 'Objectives imported'));

r.put('/academics/objectives/:id', MANAGE, id, validate(V.objectiveUpdate),
  async (req: Request, res: Response) => ok(res, await core.updateObjective(req, pid(req), v(req)), 'Objective updated'));

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------
r.get('/academics/timetable', READ, validate(V.timetableQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await teach.getTimetable(req.user!, v(req, 'query')), 'Timetable'));

r.get('/academics/timetable/insights', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await teach.timetableInsights(req.user!, v(req, 'query').campusId), 'Timetable insights'));

r.put('/academics/timetable/entries/:id', MANAGE, id, validate(V.timetableEntryUpdate),
  async (req: Request, res: Response) => ok(res, await teach.updateEntry(req, pid(req), v(req)), 'Timetable updated'));

r.get('/academics/timetable/entries/:id/substitutes', MANAGE, id,
  async (req: Request, res: Response) => ok(res, await teach.substituteSuggestions(req.user!, pid(req)), 'Substitute suggestions'));

r.post('/academics/timetable/entries/:id/substitute', MANAGE, id, validate(V.substituteAssign),
  async (req: Request, res: Response) => {
    const b = v(req);
    const out = await teach.assignSubstitute(req, pid(req), b.substituteId, b.note);
    return ok(res, out, `${out.substitute} assigned as cover`);
  });

r.delete('/academics/timetable/entries/:id/substitute', MANAGE, id,
  async (req: Request, res: Response) => ok(res, await teach.clearSubstitute(req, pid(req)), 'Cover removed'));

r.post('/academics/timetable/publish', MANAGE, validate(V.timetablePublish),
  async (req: Request, res: Response) => {
    const b = v(req);
    return ok(res, await teach.publishTimetable(req, b.sectionId, b.note), 'Timetable changes published');
  });

// ---------------------------------------------------------------------------
// Assessments & marks
// ---------------------------------------------------------------------------
r.get('/academics/assessments', READ, validate(V.assessmentsQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await asm.listAssessments(req.user!, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Assessments retrieved');
  });

r.get('/academics/assessments/summary', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await asm.assessmentSummary(req.user!, v(req, 'query').campusId), 'Assessment summary'));

r.get('/academics/assessments/:id', READ, id,
  async (req: Request, res: Response) => ok(res, await asm.getAssessment(req.user!, pid(req)), 'Assessment'));

r.post('/academics/assessments', MARKS, validate(V.assessmentCreate),
  async (req: Request, res: Response) => created(res, await asm.createAssessment(req, v(req)), 'Assessment created'));

r.put('/academics/assessments/:id/marks', MARKS, id, validate(V.marksSave),
  async (req: Request, res: Response) => {
    const out = await asm.saveMarks(req, pid(req), v(req));
    const msg = out.status === 'Moderation' ? 'Marks saved and sent for moderation' : out.status === 'Completed' ? 'Assessment completed' : 'Marks saved';
    return ok(res, out, msg);
  });

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------
r.get('/academics/question-bank/topics', READ, validate(V.topicsQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await asm.questionTopics(v(req, 'query')), 'Question bank topics'));

r.get('/academics/question-bank', READ, validate(V.questionsQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await asm.listQuestions(f);
    return paged(res, rows, total, f.page, f.pageSize, 'Questions retrieved');
  });

r.post('/academics/question-bank', MANAGE, validate(V.questionCreate),
  async (req: Request, res: Response) => created(res, await asm.createQuestion(req, v(req)), 'Question added'));

r.put('/academics/question-bank/:id', MANAGE, id, validate(V.questionUpdate),
  async (req: Request, res: Response) => ok(res, await asm.updateQuestion(req, pid(req), v(req)), 'Question updated'));

r.delete('/academics/question-bank/:id', MANAGE, id,
  async (req: Request, res: Response) => ok(res, await asm.deleteQuestion(req, pid(req)), 'Question deleted'));

// ---------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------
r.get('/academics/lesson-plans', READ, validate(V.lessonPlansQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await plan.listLessonPlans(req.user!, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Lesson plans retrieved');
  });

r.get('/academics/lesson-plans/summary', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await plan.lessonPlanSummary(req.user!, v(req, 'query').campusId), 'Lesson plan summary'));

r.get('/academics/lesson-plans/:id', READ, id,
  async (req: Request, res: Response) => ok(res, await plan.getLessonPlan(req.user!, pid(req)), 'Lesson plan'));

r.post('/academics/lesson-plans', MANAGE, validate(V.lessonPlanCreate),
  async (req: Request, res: Response) => created(res, await plan.createLessonPlan(req, v(req)), 'Lesson plan saved'));

r.put('/academics/lesson-plans/:id', MANAGE, id, validate(V.lessonPlanUpdate),
  async (req: Request, res: Response) => ok(res, await plan.updateLessonPlan(req, pid(req), v(req)), 'Lesson plan updated'));

r.post('/academics/lesson-plans/:id/transition', MANAGE, id, validate(V.lessonPlanTransition),
  async (req: Request, res: Response) => {
    const b = v(req);
    if (b.action === 'approve' || b.action === 'reject') assertDecider(req.user, 'Approving or rejecting a lesson plan');
    const out = await plan.transitionLessonPlan(req, pid(req), b.action, b.note);
    return ok(res, out, `Lesson plan ${out.status.toLowerCase()}`);
  });

r.delete('/academics/lesson-plans/:id', MANAGE, id,
  async (req: Request, res: Response) => ok(res, await plan.deleteLessonPlan(req, pid(req)), 'Draft lesson plan deleted'));

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------
r.get('/academics/homework', READ, validate(V.homeworkQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await plan.listHomework(req.user!, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Homework retrieved');
  });

r.get('/academics/homework/summary', READ, validate(V.campusQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await plan.homeworkSummary(req.user!, v(req, 'query').campusId), 'Homework summary'));

r.post('/academics/homework', MANAGE, validate(V.homeworkCreate),
  async (req: Request, res: Response) => created(res, await plan.createHomework(req, v(req)), 'Homework set'));

r.post('/academics/homework/:id/close', MANAGE, id,
  async (req: Request, res: Response) => ok(res, await plan.setHomeworkStatus(req, pid(req), 'Closed'), 'Homework closed'));

r.post('/academics/homework/:id/publish', MANAGE, id,
  async (req: Request, res: Response) => ok(res, await plan.setHomeworkStatus(req, pid(req), 'Open'), 'Homework published'));

r.post('/academics/homework/:id/remind', MANAGE, id,
  async (req: Request, res: Response) => {
    const out = await plan.remindHomework(req, pid(req));
    return ok(res, out, out.students ? `Reminder queued for parents of ${out.students} student(s)` : 'Everyone has submitted — no reminder needed');
  });

r.get('/academics/homework/:id/submissions', READ, id,
  async (req: Request, res: Response) => ok(res, await plan.homeworkSubmissions(req.user!, pid(req)), 'Submissions'));

r.put('/academics/homework/:id/submissions', MANAGE, id, validate(V.submissionSave),
  async (req: Request, res: Response) => ok(res, await plan.saveSubmission(req, pid(req), v(req)), 'Submission updated'));

// ---------------------------------------------------------------------------
// Report cards
// ---------------------------------------------------------------------------
r.get('/academics/report-cards', READ, validate(V.reportCardsQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await rep.listReportCards(req.user!, v(req, 'query')), 'Report cards'));

r.post('/academics/report-cards/release', MANAGE, validate(V.releaseApproved),
  async (req: Request, res: Response) => {
    assertDecider(req.user, 'Approving report cards for release'); // the Approval stage decision is the Super Admin's
    const out = await rep.releaseApproved(req, v(req).campusId);
    return ok(res, out, out.released ? `Released ${out.released} class(es) to parents` : 'No approved report cards were waiting');
  });

r.get('/academics/report-cards/:id', READ, id, validate(V.batchStudentQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await rep.getBatch(req.user!, pid(req), v(req, 'query').studentId), 'Report card batch'));

r.post('/academics/report-cards/:id/advance', MANAGE, id, validate(V.batchAdvance),
  async (req: Request, res: Response) => {
    if (v(req).toStage >= 5) assertDecider(req.user, 'Approving report cards for release');
    const out = await rep.advanceBatch(req, pid(req), v(req).toStage);
    return ok(res, out, `Moved to ${out.status}`);
  });

r.post('/academics/report-cards/:id/draft-missing', MANAGE, id,
  async (req: Request, res: Response) => {
    const out = await rep.draftMissingComments(req, pid(req));
    return ok(res, out, out.drafted ? `${out.drafted} draft comment(s) generated — review before approving` : 'Every student already has a comment');
  });

r.post('/academics/report-card-comments/:id/review', MANAGE, id, validate(V.commentReview),
  async (req: Request, res: Response) => {
    const b = v(req);
    const out = await rep.reviewComment(req, pid(req), b);
    return ok(res, out, b.action === 'regenerate' ? 'New draft generated — review before approving' : `Comment ${out.status.toLowerCase()}`);
  });

// ---------------------------------------------------------------------------
// Academic performance (student data — scoped per user)
// ---------------------------------------------------------------------------
r.get('/academics/performance', STAFF_STUDENTS, validate(V.performanceQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await rep.performanceOverview(req.user!, v(req, 'query')), 'Academic performance'));

r.get('/academics/performance/students', STAFF_STUDENTS, validate(V.performanceStudentsQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await rep.performanceStudents(req.user!, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Student performance');
  });

export default r;
