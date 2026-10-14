import { NAV } from './nav';

export interface RouteMeta {
  /** Sidebar section that lists the page, e.g. "Finance". */
  group: string;
  /** Menu label of the page, e.g. "Fee Collection". */
  label: string;
  /** Route of the menu entry (the list page for detail routes). */
  to: string;
  /** Menu icon of the page and its module hue (a --hue-* token suffix). */
  icon: string;
  hue: string;
  /** True when the current path is a detail page under the entry (e.g. /student-360/:id). */
  nested: boolean;
}

const ENTRIES = NAV.flatMap((g) =>
  g.items.filter((i) => !i.dynamicHome).map((i) => ({ group: g.label ?? g.group, label: i.label, to: i.to.split('?')[0], icon: i.icon, hue: g.hue ?? 'brand' })),
);

/** The menu entry a path belongs to: an exact match first, then the longest parent route. */
export function routeMeta(pathname: string): RouteMeta | null {
  const exact = ENTRIES.find((e) => e.to === pathname);
  if (exact) return { ...exact, nested: false };
  let best: (typeof ENTRIES)[number] | undefined;
  for (const e of ENTRIES) {
    if (pathname.startsWith(e.to + '/') && (!best || e.to.length > best.to.length)) best = e;
  }
  return best ? { ...best, nested: true } : null;
}
