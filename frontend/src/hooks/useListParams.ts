import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Sort } from '@/components/ui/table';

/**
 * List state (search, filters, sort, page) kept in the URL, so filtered views
 * can be bookmarked, shared and survive a reload.
 *
 *   const list = useListParams({ sort: 'name', pageSize: 25 }, ['grade', 'risk']);
 *   usePagedQuery('/students', list.query)
 */
export function useListParams(defaults: { sort?: string; dir?: 'asc' | 'desc'; pageSize?: number } = {}, filterKeys: string[] = []) {
  const [sp, setSp] = useSearchParams();
  // setSearchParams hands its updater the params of the last render, so two calls in one
  // handler (e.g. set the class, then clear the section) would drop the first change.
  // Each update builds on the previous one until the URL re-renders.
  const latest = useRef(sp);
  latest.current = sp;

  const state = useMemo(() => {
    const filters: Record<string, string> = {};
    for (const k of filterKeys) filters[k] = sp.get(k) ?? '';
    return {
      q: sp.get('q') ?? '',
      page: Math.max(1, Number(sp.get('page')) || 1),
      pageSize: Number(sp.get('pageSize')) || defaults.pageSize || 25,
      sort: { key: sp.get('sort') ?? defaults.sort ?? 'name', dir: (sp.get('dir') as 'asc' | 'desc') ?? defaults.dir ?? 'asc' } as Sort,
      filters,
    };
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((patch: Record<string, string | number | null | undefined>, resetPage = true) => {
    const next = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage && !('page' in patch)) next.delete('page');
    latest.current = next;
    setSp(next, { replace: true });
  }, [setSp]);

  return {
    ...state,
    setQ: (q: string) => update({ q }),
    setPage: (page: number) => update({ page: page > 1 ? page : null }, false),
    setPageSize: (pageSize: number) => update({ pageSize }),
    setSort: (s: Sort) => update({ sort: s.key, dir: s.dir }),
    setFilter: (key: string, value: string) => update({ [key]: value }),
    clear: () => update(Object.fromEntries(['q', ...filterKeys].map((k) => [k, null]))),
    /** Params ready for usePagedQuery. */
    query: {
      q: state.q || undefined,
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort.key,
      dir: state.sort.dir,
      ...Object.fromEntries(Object.entries(state.filters).filter(([, v]) => v)),
    },
    hasFilters: !!state.q || Object.values(state.filters).some(Boolean),
  };
}
