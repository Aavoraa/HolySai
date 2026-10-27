import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertItem, Banner, Button, Card, Chart, Chips, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination,
  SearchInput, Skeleton, TextField, Toolbar, charts,
} from '@/components/ui';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import {
  LOG_CHANNELS, LOG_OUTCOMES, LogContactModal, LogTable, PURPOSES, ParentHistoryModal, SOURCE_META, TARGET_LABEL, UpdateEntryModal,
} from './shared';
import type { KeyCount, LogRow, Source, Summary, Targets, TopParent } from './types';

const SOURCES: Source[] = ['manual', 'communication', 'message', 'visitor', 'ptm'];

function isoDay(offset = 0) {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const hbarRows = (rows: KeyCount[] | undefined, limit = 8) => (rows ?? []).slice(0, limit).map((r) => ({ label: r.key, value: r.n }));

export default function ParentLogPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const [sp, setSp] = useSearchParams();
  const list = useListParams({ sort: 'occurredAt', dir: 'desc', pageSize: 25 },
    ['from', 'to', 'contactKind', 'target', 'targetEmployeeId', 'channel', 'purpose', 'outcome', 'source', 'open', 'parentId']);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState<LogRow | null>(null);

  const from = list.filters.from || isoDay(-29);
  const to = list.filters.to || isoDay(0);
  const historyFor = sp.get('parent');
  const openHistory = (id: string | null) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('parent', id); else next.delete('parent');
    return next;
  }, { replace: true });

  const summary = useApiQuery<Summary>('/parent-log/summary', { from, to, ...campusParam });
  const targets = useApiQuery<Targets>('/parent-log/targets', campusParam, { staleTime: 5 * 60_000 });
  const log = usePagedQuery<LogRow>('/parent-log', { ...list.query, from, to, ...campusParam });
  const s = summary.data;
  const t = s?.totals;
  const bySource = Object.fromEntries((s?.bySource ?? []).map((b) => [b.key, b.n]));

  const setRange = (days: number) => { list.setFilter('from', isoDay(-(days - 1))); };
  const rangeDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;

  return (
    <Page>
      <PageHead
        title="Parent Contact Log"
        sub="How often parents and staff approach or try to reach the Principal and staff — walk-ins and calls recorded at the front office, plus messages, app conversations, gate visits and PTM bookings already in the system."
        actions={can('parentlog.manage') && <Button variant="primary" icon="plus" onClick={() => setLogOpen(true)}>Log a contact</Button>}
      />

      <Toolbar>
        <TextField label="From" type="date" value={from} max={to} onChange={(v) => list.setFilter('from', v)} style={{ width: 160 }} />
        <TextField label="To" type="date" value={to} min={from} max={isoDay(0)} onChange={(v) => list.setFilter('to', v)} style={{ width: 160 }} />
        <Chips items={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '60', label: '60 days' }, { id: '90', label: '90 days' }]}
          active={!list.filters.to && [7, 30, 60, 90].includes(rangeDays) ? String(rangeDays) : ''}
          onChange={(v) => { list.setFilter('to', ''); setRange(Number(v)); }} />
      </Toolbar>

      {s?.scope === 'mine' && <Banner icon="info">You are seeing contacts you logged and contacts that were addressed to you. The full log is available to the Principal, office and management.</Banner>}

      {summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
        <Grid cols="g-4col" className="mt-3">
          <Kpi icon="activity" label="Contacts in range" loading={summary.isLoading} value={fmt.n(t?.total)}
            foot={t ? `${fmt.n(t.fromParents)} from parents · ${fmt.n(t.fromStaff)} from staff · ${fmt.n(t.distinctParents)} families` : ' '}
            onClick={() => list.clear()} />
          <Kpi icon="user" label="Attempts to reach the Principal" tone="violet" loading={summary.isLoading} value={fmt.n(t?.toPrincipal)}
            foot={t ? `${fmt.n(t.principalUnreached)} could not get through · ${fmt.n(t.principalOpen)} still open` : ' '}
            onClick={() => list.setFilter('target', 'principal')} />
          <Kpi icon="clock" label="Pending / unresolved" tone={t?.followUpsOverdue ? 'critical' : t?.open ? 'amber' : 'teal'} loading={summary.isLoading} value={fmt.n(t?.open)}
            foot={t ? (t.followUpsOverdue ? `${fmt.n(t.followUpsOverdue)} follow-ups overdue` : 'No overdue follow-ups') : ' '}
            onClick={() => list.setFilter('open', 'true')} />
          <Kpi icon="refresh" label="Repeat contacts" tone={t?.repeatContacts ? 'critical' : 'teal'} loading={summary.isLoading} value={fmt.n(t?.repeatContacts)}
            foot="3+ attempts in 14 days, none resolved" />
        </Grid>
      )}

      <Grid cols="g-3col" className="mt-4">
        <Card icon="phone" title="By channel" sub="How people tried to get in touch">
          {summary.isLoading ? <Skeleton height={200} /> : s?.byChannel.length
            ? <Chart svg={charts.hbar({ rows: hbarRows(s.byChannel), labelW: 110 })} />
            : <Empty icon="phone" title="No contacts in this range" />}
        </Card>
        <Card icon="target" title="By purpose" sub="Why they wanted to meet">
          {summary.isLoading ? <Skeleton height={200} /> : s?.byPurpose.length
            ? <Chart svg={charts.hbar({ rows: hbarRows(s.byPurpose), labelW: 120 })} />
            : <Empty icon="target" title="No contacts in this range" />}
        </Card>
        <Card icon="barChart" title="Weekly trend" sub="All contacts and attempts to reach the Principal">
          {summary.isLoading ? <Skeleton height={200} /> : s?.byWeek.length ? (
            <>
              <Chart svg={charts.bar({
                labels: s.byWeek.map((w) => fmt.dateShort(w.week)),
                series: [
                  { name: 'All contacts', values: s.byWeek.map((w) => w.total), color: 'var(--viz-1)' },
                  { name: 'To the Principal', values: s.byWeek.map((w) => w.toPrincipal), color: 'var(--viz-3)' },
                ],
                height: 220, label: 'Contacts per week',
              })} />
              <div className="row g-3 t-xs t-muted mt-2">
                <span className="row g-1"><span className="dot" style={{ background: 'var(--viz-1)' }} />All contacts</span>
                <span className="row g-1"><span className="dot" style={{ background: 'var(--viz-3)' }} />To the Principal</span>
              </div>
            </>
          ) : <Empty icon="barChart" title="No contacts in this range" />}
        </Card>
      </Grid>

      <div className="grid g-main mt-4">
        <Card icon="users" flush title="Most frequent contacts" sub="Parents who approached most often in this range — open one to see the full history">
          {summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
            <DataTable<TopParent>
              rows={s?.topParents} loading={summary.isLoading} rowKey={(r) => r.parentId} onRowClick={(r) => openHistory(r.parentId)}
              emptyText="No parent contacts in this range."
              columns={[
                { key: 'name', label: 'Parent', sortable: false, render: (r) => <span className="col"><span className="t-sm t-bold">{r.fullName}</span><span className="t-micro t-muted">{r.parentCode} · {r.phone}</span></span> },
                { key: 'contacts', label: 'Contacts', sortable: false, className: 'num', render: (r) => <span className="t-num t-bold">{fmt.n(r.contacts)}</span> },
                { key: 'toPrincipal', label: 'To Principal', sortable: false, className: 'num', render: (r) => <span className="t-num">{fmt.n(r.toPrincipal)}</span> },
                { key: 'last', label: 'Last contact', sortable: false, render: (r) => <span className="col"><span className="t-sm">{fmt.relative(r.lastContactAt)}</span><span className="t-micro t-muted">{r.lastChannel} · {r.lastPurpose}</span></span> },
                { key: 'open', label: 'Open', sortable: false, className: 'num', render: (r) => r.open ? <span className="badge badge--warning">{r.open}</span> : <span className="t-muted">0</span> },
              ]}
            />
          )}
        </Card>
        <div className="col g-4">
          <Card icon="alertCircle" title="Repeat-contact alerts" sub={s ? `Since ${fmt.date(s.range.repeatFrom)} · 3+ attempts, none resolved` : ' '}>
            {summary.isLoading ? <Skeleton height={120} /> : s?.repeatContacts.length ? (
              <div className="col g-2">
                {s.repeatContacts.map((r) => (
                  <AlertItem key={r.key} tone="critical" icon="refresh"
                    title={`${r.contactName} — ${r.attempts} attempts${r.toPrincipal ? ` (${r.toPrincipal} to the Principal)` : ''}`}
                    meta={`${r.lastPurpose} · ${r.channels.join(', ')} · last ${fmt.relative(r.lastAt)}: ${r.lastOutcome}`}
                    onClick={r.parentId ? () => openHistory(r.parentId) : undefined} />
                ))}
              </div>
            ) : <Empty icon="checkSquare" title="No repeat contacts" sub="Nobody has had to try three times without a resolution." />}
          </Card>
          <Card icon="userCheck" title="Staff most approached" sub="Excluding the Principal">
            {summary.isLoading ? <Skeleton height={120} /> : s?.staffApproached.length
              ? <Chart svg={charts.hbar({ rows: s.staffApproached.map((x) => ({ label: x.fullName, value: x.contacts, display: x.open ? `${x.contacts} · ${x.open} open` : String(x.contacts) })), labelW: 150 })} />
              : <Empty icon="users" title="No staff contacts in this range" />}
          </Card>
        </div>
      </div>

      <Card icon="list" flush title="Contact log" sub={`${fmt.date(from)} – ${fmt.date(to)}`} className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name, phone, child, summary or code" />
          <FilterSelect label="Who" value={list.filters.contactKind} onChange={(v) => list.setFilter('contactKind', v)}
            options={[{ value: 'parent', label: 'Parents' }, { value: 'teacher', label: 'Teachers' }, { value: 'staff', label: 'Other staff' }, { value: 'other', label: 'Others' }]} />
          <FilterSelect label="Wanted to reach" value={list.filters.target} onChange={(v) => { list.setFilter('target', v); }}
            options={Object.entries(TARGET_LABEL).map(([value, label]) => ({ value, label }))} />
          <FilterSelect label="Staff member" value={list.filters.targetEmployeeId} onChange={(v) => list.setFilter('targetEmployeeId', v)}
            options={(targets.data?.staff ?? []).map((x) => ({ value: x.id, label: x.fullName }))} />
          <FilterSelect label="Channel" value={list.filters.channel} onChange={(v) => list.setFilter('channel', v)} options={LOG_CHANNELS} />
          <FilterSelect label="Purpose" value={list.filters.purpose} onChange={(v) => list.setFilter('purpose', v)} options={PURPOSES} />
          <FilterSelect label="Outcome" value={list.filters.outcome} onChange={(v) => list.setFilter('outcome', v)} options={LOG_OUTCOMES} />
          <FilterSelect label="Status" value={list.filters.open} onChange={(v) => list.setFilter('open', v)}
            options={[{ value: 'true', label: 'Open only' }, { value: 'false', label: 'Closed only' }]} />
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
          <div className="spacer" />
          <span className="t-sm t-muted t-num">{log.data ? `${fmt.n(log.data.meta.total)} contacts` : ''}</span>
        </Toolbar>
        <div className="pe-chips mt-3">
          <Chips items={[{ id: '', label: 'All sources', count: t?.total }, ...SOURCES.map((x) => ({ id: x, label: SOURCE_META[x].label, count: bySource[x] ?? 0 }))]}
            active={list.filters.source} onChange={(v) => list.setFilter('source', v)} />
        </div>
        {log.error ? <ErrorState error={log.error} onRetry={log.refetch} /> : (
          <LogTable rows={log.data?.rows} loading={log.isLoading || log.isFetching} sort={list.sort} onSort={list.setSort}
            onEdit={setEditing} onParent={openHistory}
            emptyText={list.hasFilters ? 'No contacts match the current filters.' : 'No contacts recorded in this range. Use “Log a contact” to record a walk-in or call.'} />
        )}
        <Pagination meta={log.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <LogContactModal open={logOpen} onClose={() => setLogOpen(false)} campusId={campusParam.campusId} />
      <UpdateEntryModal row={editing} onClose={() => setEditing(null)} />
      <ParentHistoryModal parentId={historyFor} onClose={() => openHistory(null)} onEdit={(r) => setEditing(r)} />
    </Page>
  );
}
