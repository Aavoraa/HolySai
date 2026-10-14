import type { ReactNode } from 'react';
import { cx, fmt } from '@/lib/format';
import { Button, Icon } from './primitives';
import { LotusArt } from './LotusArt';
import type { PageMeta } from '@/api/client';

export interface Column<T> {
  key: string;
  label: string;
  /** Cell renderer; defaults to row[key]. */
  render?: (row: T, index: number) => ReactNode;
  className?: string;
  width?: string;
  sortable?: boolean;
}

export interface Sort {
  key: string;
  dir: 'asc' | 'desc';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  sort?: Sort;
  onSort?: (s: Sort) => void;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelect?: (next: Set<string>) => void;
  emptyText?: ReactNode;
  compact?: boolean;
  /** Tables collapse into card lists below 768px (wireframe behaviour). */
  stack?: boolean;
  rowClassName?: (row: T) => string | undefined;
}

/** Responsive table with server-side sorting, row selection and loading skeleton. */
export function DataTable<T>({
  columns, rows, rowKey, loading, sort, onSort, onRowClick, selectable, selected, onSelect,
  emptyText = 'No records match the current filters.', compact, stack = true, rowClassName,
}: Props<T>) {
  const data = rows ?? [];
  const allSelected = selectable && data.length > 0 && data.every((r) => selected?.has(rowKey(r)));

  const toggleAll = () => {
    if (!onSelect) return;
    const next = new Set(selected);
    if (allSelected) data.forEach((r) => next.delete(rowKey(r)));
    else data.forEach((r) => next.add(rowKey(r)));
    onSelect(next);
  };
  const toggle = (id: string) => {
    if (!onSelect) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };

  return (
    <div className="table-wrap">
      <table className={cx('table', compact && 'table--compact', stack && 'table--stack')} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 38 }}>
                <input type="checkbox" aria-label="Select all" checked={!!allSelected} onChange={toggleAll} />
              </th>
            )}
            {columns.map((c) => {
              const canSort = !!onSort && c.sortable !== false;
              const sorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className={cx(c.className, canSort && 'sortable')}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={sorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={canSort ? () => onSort!({ key: c.key, dir: sorted && sort!.dir === 'asc' ? 'desc' : 'asc' }) : undefined}
                  tabIndex={canSort ? 0 : undefined}
                  onKeyDown={canSort ? (e) => { if (e.key === 'Enter') onSort!({ key: c.key, dir: sorted && sort!.dir === 'asc' ? 'desc' : 'asc' }); } : undefined}
                >
                  {c.label}
                  {canSort && (
                    <span className="sort-ind">
                      <Icon name={sorted && sort!.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={11} />
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && !data.length
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk${i}`}>
                  {selectable && <td />}
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.label}>
                      <span className="skeleton" style={{ display: 'block', height: 14, width: `${50 + ((i * 7 + c.key.length * 5) % 45)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            : data.map((r, i) => {
                const id = rowKey(r);
                const isSel = !!selected?.has(id);
                return (
                  <tr
                    key={id}
                    className={cx(onRowClick && 'row--link', isSel && 'is-selected', rowClassName?.(r))}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    style={loading ? { opacity: 0.6 } : undefined}
                  >
                    {selectable && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Select row" checked={isSel} onChange={() => toggle(id)} />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={c.className} data-label={c.label}>
                        {c.render ? c.render(r, i) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading && !data.length && <div className="table__empty"><span className="empty__art empty__art--sm"><LotusArt /><span className="empty__badge"><Icon name="search" size={12} /></span></span>{emptyText}</div>}
    </div>
  );
}

export function Pagination({ meta, onPage, onPageSize }: { meta?: PageMeta; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="t-xs t-muted">
        Showing <strong className="t-num t-strong">{fmt.n(from)}–{fmt.n(to)}</strong> of <strong className="t-num t-strong">{fmt.n(meta.total)}</strong>
      </span>
      <div className="pager__nav">
        {onPageSize && (
          <select className="select" aria-label="Rows per page" value={meta.pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <Button size="sm" icon="chevronLeft" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page" title="Previous page" />
        <span className="t-xs t-num t-muted" aria-live="polite">Page <strong className="t-strong">{meta.page}</strong> of {meta.totalPages}</span>
        <Button size="sm" icon="chevronRight" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page" title="Next page" />
      </div>
    </nav>
  );
}

/** Toolbar row that sits above a table inside a flush card. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function BulkBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  if (!count) return null;
  return (
    <div className="bulkbar">
      <strong>{count} selected</strong>
      <div className="row g-2">{children}</div>
      <span className="spacer" />
      <Button size="sm" variant="quiet" onClick={onClear}>Clear</Button>
    </div>
  );
}
