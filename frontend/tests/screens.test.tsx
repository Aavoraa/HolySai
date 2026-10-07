/**
 * Screen smoke test: renders every route each role may open, against the REAL
 * running API (seeded database), and fails on render crashes, console errors,
 * or error states shown to the user.
 *
 * Requires: API on API_URL (default http://127.0.0.1:4000) and SEED_DEMO_PASSWORD.
 *   npm run test:screens --workspace frontend
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const API = (process.env.API_URL ?? 'http://127.0.0.1:4000') + '/api';
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
const session: { current: { accessToken: string } | null } = { current: null };

vi.mock('@/api/client', async (orig) => {
  const mod = await orig<typeof import('@/api/client')>();
  return { ...mod, refreshAccessToken: async () => session.current };
});

const { setAccessToken } = await import('@/api/client');
const { AuthProvider } = await import('@/auth/AuthContext');
const { I18nProvider } = await import('@/i18n/I18nProvider');
const { ConfirmProvider, ToastProvider } = await import('@/components/ui');
const { APP_ROUTES } = await import('@/pages/registry');
const { default: App } = await import('@/App');

const ACCOUNTS: Record<string, string> = {
  principal: 'meera.krishnan.demo@holysai.edu',
  teacher: 'priya.raghavan.demo@holysai.edu',
  parent: 'ranjith.kumar.demo@parents.holysai.edu',
  office: 'kavitha.s.demo@holysai.edu',
  staff: 'murugan.p.demo@holysai.edu',
  hr: 'lakshmi.n.demo@holysai.edu',
  finance: 'rajesh.iyer.demo@holysai.edu',
  student: 'aditya.kumar.demo@students.holysai.edu',
};

async function apiGet(path: string, token: string) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).data;
}

async function login(email: string) {
  const r = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD, clientType: 'mobile' }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`login failed for ${email}: ${j.message}`);
  return j.data as { accessToken: string; user: { permissions: string[] } };
}

/** Values for route parameters, looked up once with an admin token. */
async function paramValues(token: string) {
  const s = await apiGet('/students/HS-2026-1041', token);
  const projects = await apiGet('/innovation/projects?pageSize=1', token).catch(() => []);
  const slips = await apiGet('/payslips?pageSize=1', token).catch(() => []);
  return {
    studentId: s.id as string,
    projectId: (Array.isArray(projects) ? projects[0]?.id : undefined) as string | undefined,
    payslipId: (Array.isArray(slips) ? slips[0]?.id : undefined) as string | undefined,
  };
}

function resolvePath(path: string, p: Awaited<ReturnType<typeof paramValues>>, role: string) {
  return path
    .replace('/admin/reports/:key', '/admin/reports/attendance-daily')
    .replace('/projects/:id', p.projectId ? `/projects/${p.projectId}` : '/projects/__missing__')
    .replace('/staff-self/payslips/:id', role === 'staff' ? '/staff-self' : '/staff-self')
    .replace('/payslips/:id', p.payslipId ? `/payslips/${p.payslipId}` : '/payslips')
    .replace(':studentId', p.studentId)
    .replace(':id', p.studentId);
}

async function settle(container: HTMLElement, timeoutMs = 12000) {
  const start = Date.now();
  let quietSince = 0;
  while (Date.now() - start < timeoutMs) {
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    const busy = container.querySelector('.skeleton, [aria-busy="true"]:not(button)');
    if (!busy) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince > 600) return true;
    } else quietSince = 0;
  }
  return false;
}

const ERROR_TEXT = [/We could not load this/i, /Something went wrong/i, /Screen not found/i, /Not available for this role/i, /Cannot reach the server/i, /Not available for your role/i];

const TABS: Record<string, string[]> = {
  '/parent-360': ['track', 'academics', 'safety', 'fees', 'more'],
  '/student-360/:id': ['academics', 'attendance', 'skills', 'activities', 'behaviour', 'wellbeing', 'achievements', 'portfolio', 'interventions', 'documents', 'tracking'],
  '/my-profile': ['academics', 'documents'],
  '/student-tracking/:id': [],
};

const errors: string[] = [];
const origError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map(String).join(' ');
  // Known jsdom limitations, not application errors
  if (/Not implemented: (HTMLCanvasElement|window.scrollTo|navigation)|Could not parse CSS stylesheet/.test(msg)) return;
  errors.push(msg.slice(0, 400));
};
afterAll(() => { console.error = origError; });

/** Content that must appear, proving the screen shows real data (not just no errors). */
const EXPECT: Record<string, RegExp[]> = {
  '/parent-360': [/Aditya/, /Open live location/],
  '/parent-360?tab=track': [/Student Tracking/, /Latitude/, /Longitude/, /Last Updated/],
  '/parent-360?tab=fees': [/Total outstanding/, /Tuition/],
  '/parent-360?tab=safety': [/Pickup authorisation/],
  '/parent-360?tab=more': [/Parent–teacher meeting/, /Circulars/],
  '/student-360/:id': [/Aditya Kumar/, /HS-2026-1041/, /Growth timeline/],
  '/student-360/:id?tab=tracking': [/Student Tracking/, /Latitude/, /Last Updated/],
  '/student-tracking': [/Student Tracking/, /Students tracked/],
  '/student-tracking/:id': [/Aditya Kumar/, /Latitude/],
  '/command-center': [/Total Students/, /Attendance analytics/],
  '/students': [/Aditya Kumar|Students/],
};

const onlyRoles = process.env.ROLES?.split(',');
const report: string[] = [];

describe.each(Object.keys(ACCOUNTS).filter((r) => !onlyRoles || onlyRoles.includes(r)))('screens as %s', (role) => {
  it('renders every permitted route without errors', async () => {
    const { accessToken, user } = await login(ACCOUNTS[role]);
    const admin = await login(ACCOUNTS.principal);
    const params = await paramValues(admin.accessToken);
    const perms = new Set(user.permissions);
    const routes = APP_ROUTES.filter((r) => !r.perm || r.perm.some((p) => perms.has(p)));
    const failures: string[] = [];

    const targets = routes.flatMap((r) => [r.path, ...(TABS[r.path] ?? []).map((t) => `${r.path}?tab=${t}`)]);
    for (const target of targets) {
      if (role === 'student' && target.startsWith('/student-360')) continue;
      const path = resolvePath(target, params, role);
      errors.length = 0;
      setAccessToken(accessToken);
      session.current = { accessToken };
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
      const { container, unmount } = render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[path]}>
            <I18nProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <AuthProvider>
                    <App />
                  </AuthProvider>
                </ConfirmProvider>
              </ToastProvider>
            </I18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const settled = await settle(container);
      const text = container.textContent ?? '';
      // Error states are matched on their titles (empty-state headings, page titles, critical banners), not body copy.
      const titles = [...container.querySelectorAll('.empty .h3, .pagehead__title, .banner--critical')].map((e) => e.textContent).join(' | ');
      const shown = ERROR_TEXT.filter((re) => re.test(titles)).map(String);
      const trackingTarget = /tab=tracking|tab=track|student-tracking/.test(target);
      const canTrack = ['tracking.read_all', 'tracking.read_assigned', 'tracking.read_own_children'].some((p) => perms.has(p));
      const missing = (trackingTarget && !canTrack ? [] : EXPECT[target] ?? []).filter((re) => !re.test(text)).map(String);
      if (missing.length) failures.push(`${path}: missing ${missing.join(', ')}`);
      const heading = container.querySelector('h1')?.textContent?.trim() ?? '(no h1)';
      if (!settled) failures.push(`${path}: still loading after 12 s`);
      if (shown.length) failures.push(`${path}: shows ${shown.join(', ')} — ${text.slice(0, 200)}`);
      if (errors.length) failures.push(`${path}: console.error → ${errors[0]}`);
      report.push(`${role.padEnd(9)} ${failures.some((f) => f.startsWith(path + ':')) ? 'FAIL' : 'ok  '} ${path} — ${heading}`);
      unmount();
      qc.clear();
      cleanup();
    }
    console.log(report.filter((r) => r.startsWith(role.padEnd(9))).join('\n'));
    expect(failures, failures.join('\n')).toEqual([]);
  }, 900_000);
});
