import type { ReactNode } from 'react';
import { routes as core } from './core/routes';
import { routes as students } from './students/routes';
import { routes as tracking } from './tracking/routes';
import { routes as parents } from './parents/routes';
import { routes as academics } from './academics/routes';
import { routes as admissions } from './admissions/routes';
import { routes as finance } from './finance/routes';
import { routes as workforce } from './workforce/routes';
import { routes as safety } from './safety/routes';
import { routes as parentsExperience } from './parents-experience/routes';
import { routes as operations } from './operations/routes';
import { routes as innovation } from './innovation/routes';
import { routes as group } from './group/routes';
import { routes as intelligence } from './intelligence/routes';
import { routes as reports } from './reports/routes';
import { routes as examCorrection } from './exam-correction/routes';

export interface AppRoute {
  /** react-router path, e.g. '/fees' or '/student-360/:id' */
  path: string;
  element: ReactNode;
  /** Permissions that may open the route (any of). Omit for every signed-in user. */
  perm?: string[];
}

export const APP_ROUTES: AppRoute[] = [
  ...core, ...students, ...tracking, ...parents,
  ...academics, ...admissions, ...finance, ...workforce, ...safety,
  ...parentsExperience, ...operations, ...innovation, ...group, ...intelligence, ...reports, ...examCorrection,
];

/** Starts downloading the code of the page a path opens (no-op when already loaded or unknown). */
export function preloadRoute(to: string) {
  const path = to.split('?')[0];
  const route = APP_ROUTES.find((r) => r.path === path)
    ?? APP_ROUTES.find((r) => r.path.includes('/:') && path.startsWith(r.path.slice(0, r.path.indexOf('/:') + 1)));
  const type = (route?.element as { type?: { preload?: () => Promise<unknown> } } | undefined)?.type;
  type?.preload?.().catch(() => undefined);
}
