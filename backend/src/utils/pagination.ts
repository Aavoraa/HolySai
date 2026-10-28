import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * Resolves a client-supplied sort key against an allow-list of SQL
 * expressions. Unknown keys fall back to the default, so user input never
 * reaches ORDER BY directly.
 */
export function orderBy(sort: string | undefined, dir: 'asc' | 'desc', allowed: Record<string, string>, fallback: string) {
  // Own keys only: 'constructor', 'toString' … would otherwise resolve to Object.prototype members.
  const col = (sort && Object.hasOwn(allowed, sort) && allowed[sort]) || allowed[fallback] || fallback;
  return `${col} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
}

export function limitOffset(p: { page: number; pageSize: number }) {
  return { limit: p.pageSize, offset: (p.page - 1) * p.pageSize };
}

/** Escapes LIKE wildcards in a search term and wraps it for ILIKE. */
export function likeTerm(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}
