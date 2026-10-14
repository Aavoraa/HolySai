import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, DataTable, ErrorState, Grid, Kpi, Meter, Modal, Page, PageHead, Pagination, Person,
  SearchInput, StudentLink, Tabs, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import { SendMessageModal, ackTone } from './shared';
import type { AckRow, AckSummary, Circular, DirectoryRow } from './types';

function useRemind() {
  const confirm = useConfirm();
  const m = useApiMutation<string>('post', (id) => `/circulars/${id}/remind`, { invalidate: ['/circulars', '/communications'], body: () => ({}) });
  return {
    pending: m.isPending,
    run: async (c: Circular) => {
      const pending = Math.max(0, c.targetCount - c.ackCount);
      if (await confirm({
        title: `Chase ${fmt.n(pending)} families?`,
        body: `Families who have not acknowledged “${c.title}” will get an app reminder${c.channels.includes('whatsapp') ? ' and a WhatsApp message' : ''}. Families without the app are listed so the office can call them.${c.lastRemindedAt ? ` Last reminder: ${fmt.relative(c.lastRemindedAt)}.` : ''}`,
        confirmLabel: 'Send reminder', icon: 'send',
      })) m.mutate(c.id);
    },
  };
}

export default function AcknowledgementsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'issued', dir: 'desc' }, []);
  const [sp, setSp] = useSearchParams();
  const openId = sp.get('circular');
  const setOpen = (id: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set('circular', id); else n.delete('circular'); return n; }, { replace: true });
  const summary = useApiQuery<AckSummary>('/circulars/summary', campusParam);
  const q = usePagedQuery<Circular>('/circulars', { ...list.query, ...campusParam });
  const remind = useRemind();
  const s = summary.data;

  return (
    <Page>
      <PageHead title="Acknowledgements" sub="Which families have confirmed they read each circular, and who still needs a reminder." />
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
        <Grid cols="g-3col">
          <Kpi size="hero" icon="checkSquare" label="Acknowledgement rate" tone="teal" loading={summary.isLoading} value={s?.rate == null ? '—' : `${s.rate}%`}
            foot={`${fmt.n(s?.acknowledged)} of ${fmt.n(s?.targeted)} family confirmations`} />
          <Kpi size="hero" icon="clock" label="Outstanding" tone="amber" loading={summary.isLoading} value={fmt.n(s?.outstanding)}
            foot={`Across ${fmt.n(s?.circulars)} released circular${s?.circulars === 1 ? '' : 's'}`} />
          <Kpi size="hero" icon="phone" label="Never acknowledged" tone="critical" loading={summary.isLoading} value={fmt.n(s?.neverAcknowledged)} foot="Families to call" />
        </Grid>
      )}
      <Card icon="bell" title="By circular" sub="Open a circular to see who has not confirmed and chase them" flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search circulars" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Circular>
            rows={q.data?.rows}
            loading={q.isLoading || q.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => r.status === 'Released' && r.requiresAck ? setOpen(r.id) : undefined}
            emptyText={list.hasFilters ? 'No circulars match your search.' : 'No circulars yet. Circulars that ask families to acknowledge appear here once released.'}
            columns={[
              { key: 'title', label: 'Circular', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.publishedAt ? `Released ${fmt.date(r.publishedAt)}` : r.status}</div></> },
              { key: 'audience', label: 'Audience', sortable: false, render: (r) => r.audience },
              {
                key: 'ack', label: 'Acknowledged', width: '220px', render: (r) => {
                  if (r.status === 'Draft' || r.status === 'Under Review') return <span className="t-faint">Not released</span>;
                  if (r.status === 'Withdrawn') return <span className="t-faint">Withdrawn</span>;
                  if (!r.requiresAck) return <span className="t-faint">Not required</span>;
                  return <Meter label="" value={r.targetCount ? (r.ackCount / r.targetCount) * 100 : 0} right={`${fmt.n(r.ackCount)} of ${fmt.n(r.targetCount)}`} tone={ackTone(r.ackCount, r.targetCount)} />;
                },
              },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => {
                  if (r.status !== 'Released' || !r.requiresAck) return null;
                  const pending = Math.max(0, r.targetCount - r.ackCount);
                  return (
                    <span className="adm-actions">
                      <Button size="sm" variant="quiet" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>Families</Button>
                      {can('communication.send') && pending > 0 && (
                        <Button size="sm" icon="message" disabled={remind.pending} onClick={(e) => { e.stopPropagation(); void remind.run(r); }}>Chase {fmt.n(pending)}</Button>
                      )}
                    </span>
                  );
                },
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <FamiliesModal id={openId} onClose={() => setOpen(null)} />
    </Page>
  );
}

function FamiliesModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const [state, setState] = useState<'pending' | 'acknowledged'>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [messageTo, setMessageTo] = useState<DirectoryRow | null>(null);
  useEffect(() => { setState('pending'); setSearch(''); setPage(1); }, [id]);
  useEffect(() => setPage(1), [state, search]);
  const c = useApiQuery<Circular>(id ? `/circulars/${id}` : null);
  const rows = usePagedQuery<AckRow>(id ? `/circulars/${id}/acknowledgements` : null, { state, q: search || undefined, page, pageSize: 10 });
  const remind = useRemind();
  const circ = c.data;
  const pending = circ ? Math.max(0, circ.targetCount - circ.ackCount) : 0;

  const asParent = (r: AckRow): DirectoryRow => ({
    id: r.parentId, parentCode: '', fullName: r.parentName, phone: r.phone, email: null, occupation: null, preferredChannel: 'whatsapp',
    engagement: r.engagement, lastContactAt: null, lastContactChannel: null, hasAppAccount: r.hasAppAccount,
    children: r.children.map((x) => ({ id: x.id, fullName: x.fullName, grade: x.grade })), ptmBooked: false, openQueries: 0,
  });

  return (
    <Modal open={!!id} onClose={onClose} size="wide" busy={!!messageTo} title={circ?.title ?? 'Acknowledgements'}
      sub={circ ? `${circ.audience} · released ${fmt.date(circ.publishedAt)}` : undefined}
      foot={<>
        {circ && can('communication.send') && pending > 0 && <Button icon="message" onClick={() => remind.run(circ)} loading={remind.pending}>Chase {fmt.n(pending)}</Button>}
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      {c.error ? <ErrorState error={c.error} onRetry={c.refetch} /> : (
        <div className="col g-3">
          {circ && <Meter label="Acknowledged" value={circ.targetCount ? (circ.ackCount / circ.targetCount) * 100 : 0} right={`${fmt.n(circ.ackCount)} of ${fmt.n(circ.targetCount)}`} tone={ackTone(circ.ackCount, circ.targetCount)} lg
            hint={circ.lastRemindedAt ? `${circ.reminderCount} reminder${circ.reminderCount === 1 ? '' : 's'} sent · last ${fmt.relative(circ.lastRemindedAt)}` : 'No reminders sent yet'} />}
          <div className="row between wrap g-2">
            <Tabs items={[{ id: 'pending', label: 'Not yet acknowledged', count: state === 'pending' ? rows.data?.meta.total : undefined }, { id: 'acknowledged', label: 'Acknowledged', count: state === 'acknowledged' ? rows.data?.meta.total : undefined }]}
              active={state} onChange={setState} pills />
            <SearchInput value={search} onSearch={setSearch} placeholder="Search families" maxWidth={220} />
          </div>
          {rows.error ? <ErrorState error={rows.error} onRetry={rows.refetch} /> : (
            <DataTable<AckRow>
              rows={rows.data?.rows}
              loading={rows.isLoading || rows.isFetching}
              rowKey={(r) => r.parentId}
              compact
              emptyText={state === 'pending' ? 'Every family has acknowledged.' : 'No acknowledgements yet.'}
              columns={[
                { key: 'parent', label: 'Family', render: (r) => <Person name={r.parentName} meta={r.phone} to={`/parent-directory?parent=${r.parentId}`} /> },
                { key: 'children', label: 'Children', render: (r) => <div className="col g-1">{r.children.map((x) => <StudentLink key={x.id} id={x.id} name={x.fullName} meta={x.grade ?? undefined} />)}</div> },
                {
                  key: 'state', label: state === 'pending' ? 'App' : 'Acknowledged', render: (r) => state === 'pending'
                    ? (r.hasAppAccount ? <Badge tone="info">Uses the app</Badge> : <Badge tone="warning">No app — call</Badge>)
                    : <span className="t-sm">{fmt.dateTime(r.acknowledgedAt)}</span>,
                },
                {
                  key: 'a', label: '', className: 'num', render: (r) => state === 'pending' && can('communication.send') ? (
                    <Button size="sm" icon="message" onClick={() => setMessageTo(asParent(r))}>Message</Button>
                  ) : null,
                },
              ]}
            />
          )}
          <Pagination meta={rows.data?.meta} onPage={setPage} />
        </div>
      )}
      <SendMessageModal open={!!messageTo} onClose={() => setMessageTo(null)} parent={messageTo}
        defaultSubject={circ ? `Please acknowledge: ${circ.title}` : undefined} />
    </Modal>
  );
}
