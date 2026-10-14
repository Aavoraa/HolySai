import { useState } from 'react';
import {
  Badge, Button, Card, DataTable, Dl, ErrorState, FilterSelect, Modal, Page, PageHead, Pagination, Person, SearchInput, TextField, Toolbar, errorMessage, useToast,
} from '@/components/ui';
import { api } from '@/api/client';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { capitalize } from '@/lib/tones';
import { fmt } from '@/lib/format';
import { addDaysIso, todayIso } from './shared';

interface AuditRow {
  id: number; createdAt: string; userName: string | null; role: string | null; action: string; module: string; entityType: string | null;
  entityId: string | null; description: string; ip: string | null; device: string | null; userAgent: string | null;
}
interface Facets { modules: { module: string; n: number }[]; actions: string[] }

const PERIODS: Record<string, () => { from?: string; to?: string }> = {
  today: () => ({ from: todayIso() }),
  '7d': () => ({ from: addDaysIso(-6) }),
  '30d': () => ({ from: addDaysIso(-29) }),
  year: () => {
    const t = todayIso();
    const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < 6 ? 1 : 0);
    return { from: `${y}-06-01` };
  },
};

const actionTone = (a: string) => (a === 'delete' || a === 'login_failed' ? 'critical' : a === 'approve' ? 'success' : a === 'view' ? 'neutral' : a === 'create' ? 'info' : 'warning');

export default function AuditPage() {
  const list = useListParams({ pageSize: 50 }, ['module', 'action', 'period', 'from', 'to']);
  const f = list.filters;
  const range = f.period === 'custom' ? { from: f.from || undefined, to: f.to || undefined } : f.period ? PERIODS[f.period]() : {};
  const params = { q: list.query.q, page: list.page, pageSize: list.pageSize, module: f.module || undefined, action: f.action || undefined, ...range };
  const q = usePagedQuery<AuditRow>('/audit-logs', params);
  const facets = useApiQuery<Facets>('/audit/facets', undefined, { staleTime: 60_000 });
  const [open, setOpen] = useState<AuditRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: AuditRow[] = [];
      for (let page = 1; page <= 20; page++) {
        const r = await api.getPaged<AuditRow>('/audit-logs', { ...params, page, pageSize: 200 });
        rows.push(...r.rows);
        if (page >= r.meta.totalPages) break;
      }
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['When,User,Role,Action,Module,Record type,Record id,Description,IP,Device',
        ...rows.map((r) => [r.createdAt, r.userName, r.role, r.action, r.module, r.entityType, r.entityId, r.description, r.ip, r.device].map(cell).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-trail-${todayIso()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${rows.length} entries`);
    } catch (e) { toast(errorMessage(e), 'critical'); } finally { setExporting(false); }
  };

  return (
    <Page>
      <PageHead title="Audit Trail" sub="Every consequential action, who took it and against what. Restricted records log reads as well as writes."
        actions={<Button icon="download" loading={exporting} disabled={!q.data?.meta.total} onClick={exportCsv}>Export</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search user, action or record" />
          <FilterSelect label="Module" allLabel="All modules" value={f.module} onChange={(v) => list.setFilter('module', v)}
            options={(facets.data?.modules ?? []).map((m) => ({ value: m.module, label: `${capitalize(m.module.replace(/_/g, ' '))} (${fmt.n(m.n)})` }))} />
          <FilterSelect label="Action" allLabel="All actions" value={f.action} onChange={(v) => list.setFilter('action', v)}
            options={(facets.data?.actions ?? []).map((a) => ({ value: a, label: capitalize(a.replace(/_/g, ' ')) }))} />
          <FilterSelect label="Period" allLabel="All time" value={f.period} onChange={(v) => list.setFilter('period', v)}
            options={[{ value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
              { value: 'year', label: 'This academic year' }, { value: 'custom', label: 'Custom range…' }]} />
          {f.period === 'custom' && <>
            <TextField label="From" type="date" value={f.from} max={f.to || todayIso()} onChange={(v) => list.setFilter('from', v)} style={{ width: 150 }} />
            <TextField label="To" type="date" value={f.to} min={f.from} max={todayIso()} onChange={(v) => list.setFilter('to', v)} style={{ width: 150 }} />
          </>}
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
          <span className="spacer" />
          <span className="t-sm t-muted t-num">{q.data ? `${fmt.n(q.data.meta.total)} entries` : ''}</span>
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<AuditRow>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => String(r.id)} onRowClick={setOpen} emptyText="No audit entries match these filters."
            columns={[
              { key: 'time', label: 'When', render: (r) => <span className="t-num t-sm">{fmt.dateTime(r.createdAt)}</span> },
              { key: 'user', label: 'Who', render: (r) => !r.userName || r.userName === 'System'
                ? <Badge icon="zap">System</Badge> : <Person name={r.userName} meta={r.role ? capitalize(r.role.replace(/_/g, ' ')) : undefined} /> },
              { key: 'action', label: 'Action', render: (r) => <><Badge tone={actionTone(r.action)}>{capitalize(r.action.replace(/_/g, ' '))}</Badge><div className="t-sm mt-1">{r.description}</div></> },
              { key: 'entity', label: 'Record', render: (r) => <span className="t-xs t-muted">{[capitalize(r.module), r.entityType, r.entityId && r.entityId.slice(0, 8)].filter(Boolean).join(' / ')}</span> },
              { key: 'ip', label: 'Source', render: (r) => <span className="t-xs t-faint t-num">{r.ip ?? r.device ?? '—'}</span> },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Audit entry" sub={open ? fmt.dateTime(open.createdAt) : ''}
        foot={<Button onClick={() => setOpen(null)}>Close</Button>}>
        {open && <Dl items={[
          ['Who', `${open.userName ?? 'System'}${open.role ? ` (${open.role})` : ''}`],
          ['Action', open.action], ['Module', open.module], ['Description', open.description],
          ['Record', open.entityType ? `${open.entityType} ${open.entityId ?? ''}` : '—'],
          ['IP address', open.ip ?? '—'], ['Client', open.device ?? '—'], ['User agent', <span className="t-xs">{open.userAgent ?? '—'}</span>],
        ]} />}
      </Modal>
    </Page>
  );
}
