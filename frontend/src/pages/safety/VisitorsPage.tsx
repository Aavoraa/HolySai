import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Grid, Icon, Kpi, Modal, Page, PageHead, Pagination, Person,
  SearchInput, Segment, SelectField, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { FormModal, localInputIn, localToIso, PHONE_RE, SAFETY_KEYS, todayIso, useFieldErrors } from './shared';
import { VISIT_PURPOSES, type Visitor, type VisitorSummary } from './types';

const STATUS_TONE: Record<string, string> = { Inside: 'info', Completed: 'success', Expected: 'warning', Denied: 'critical' };

export default function VisitorsPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const manage = can('safety.manage');
  const list = useListParams({ sort: 'in', dir: 'desc', pageSize: 25 }, ['status', 'date']);
  const date = list.filters.date || todayIso();
  const summary = useApiQuery<VisitorSummary>('/visitors/summary', campusParam);
  const q = usePagedQuery<Visitor>('/visitors', { ...list.query, date, ...campusParam });
  const [adding, setAdding] = useState(false);
  const [badge, setBadge] = useState<Visitor | null>(null);
  const act = useApiMutation<{ id: string; action: 'check-in' | 'check-out' | 'deny' }>('post', (v) => `/visitors/${v.id}/${v.action}`, {
    invalidate: ['/visitors', '/gate'], body: () => ({}),
  });

  const run = async (v: Visitor, action: 'check-in' | 'check-out' | 'deny') => {
    if (action === 'deny') {
      const ok = await confirm({ title: `Deny entry to ${v.fullName}?`, danger: true, confirmLabel: 'Deny entry', body: 'The pre-approval is cancelled and the visit is recorded as denied.' });
      if (!ok) return;
    }
    if (action === 'check-out') {
      const ok = await confirm({ title: `Check out ${v.fullName}?`, confirmLabel: 'Check out', icon: 'logout', body: `Collect badge ${v.badgeNo} before the visitor leaves.` });
      if (!ok) return;
    }
    act.mutate({ id: v.id, action });
  };

  const s = summary.data;
  return (
    <Page>
      <PageHead
        title="Visitor Management"
        sub="Pre-approval, ID capture, badge printing and check-out — nobody is on campus unaccounted for."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Check in a visitor</Button>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="activity" loading={!s} label="On site now" value={fmt.n(s?.onSite ?? 0)} tone="info" onClick={() => list.setFilter('status', 'Inside')} />
          <Kpi icon="activity" loading={!s} label="Today" value={fmt.n(s?.today ?? 0)} foot={s ? `${s.checkedOutToday} checked out${s.deniedToday ? ` · ${s.deniedToday} denied` : ''}` : undefined} />
          <Kpi icon="activity" loading={!s} label="Pre-approved" value={fmt.n(s?.preApproved ?? 0)} tone="teal" foot="Expected today or later" onClick={() => list.setFilter('status', 'Expected')} />
          <Kpi icon="activity" loading={!s} label="Not checked out" value={fmt.n(s?.notCheckedOut ?? 0)} tone={s?.notCheckedOut ? 'critical' : 'teal'}
            foot={s?.notCheckedOut ? 'Still inside from a previous day — reconcile now' : 'Reconciled at 17:30 daily'} />
        </Grid>
      )}

      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search visitor, badge or purpose" />
          <input className="input st-date" type="date" aria-label="Date" value={date}
            onChange={(e) => list.setFilter('date', e.target.value === todayIso() ? '' : e.target.value)} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Inside', 'Completed', 'Expected', 'Denied']} />
          {list.hasFilters && <Button variant="quiet" size="sm" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={q.data?.rows}
            loading={q.isLoading || q.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            emptyText="No visitors for this day."
            columns={[
              { key: 'badge', label: 'Badge', render: (r) => <span className="t-num t-bold">{r.badgeNo}</span> },
              { key: 'name', label: 'Visitor', render: (r) => <Person name={r.fullName} meta={r.purpose} /> },
              { key: 'host', label: 'Host', render: (r) => r.hostName ?? '—' },
              { key: 'in', label: 'In', render: (r) => r.status === 'Expected' ? <span className="t-muted">Expected {fmt.dateTime(r.checkedInAt)}</span> : r.status === 'Denied' ? <span className="t-faint">—</span> : <span className="t-num">{fmt.time(r.checkedInAt)}</span> },
              { key: 'out', label: 'Out', render: (r) => r.checkedOutAt ? <span className="t-num">{fmt.time(r.checkedOutAt)}</span> : <span className="t-faint">—</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]} dot={r.status === 'Inside'}>{r.status}</Badge> },
              {
                key: 'a', label: '', sortable: false, className: 'num',
                render: (r) => (
                  <span className="row g-1 end">
                    {r.status !== 'Denied' && <Button size="sm" variant="quiet" icon="printer" onClick={() => setBadge(r)} aria-label={`Badge ${r.badgeNo}`} />}
                    {manage && r.status === 'Inside' && <Button size="sm" onClick={() => run(r, 'check-out')} loading={act.isPending && act.variables?.id === r.id}>Check out</Button>}
                    {manage && r.status === 'Expected' && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => run(r, 'check-in')}>Arrived</Button>
                        <Button size="sm" variant="quiet" onClick={() => run(r, 'deny')}>Deny</Button>
                      </>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      {adding && <CheckInModal onClose={() => setAdding(false)} onDone={(v) => { setAdding(false); if (v.status === 'Inside') setBadge(v); }} />}
      {badge && <BadgeModal visitor={badge} onClose={() => setBadge(null)} />}
    </Page>
  );
}

function CheckInModal({ onClose, onDone }: { onClose: () => void; onDone: (v: Visitor) => void }) {
  const { lookups } = useLookups();
  const { campusParam } = useSchool();
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [f, setF] = useState({ fullName: '', phone: '', purpose: VISIT_PURPOSES[0], detail: '', hostEmployeeId: '', expectedAt: localInputIn(60) });
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, string>, Visitor>('post', '/visitors', { invalidate: [...SAFETY_KEYS], onSuccess: (r) => onDone(r.data) });
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.fullName.trim().length < 2) e.fullName = 'Enter the visitor’s name';
    if (f.phone && !PHONE_RE.test(f.phone.trim())) e.phone = 'Enter a valid phone number';
    if (!f.hostEmployeeId) e.hostEmployeeId = 'Choose who they are visiting';
    if (f.purpose === 'Other' && f.detail.trim().length < 3) e.detail = 'Describe the purpose';
    if (mode === 'later' && (!f.expectedAt || new Date(f.expectedAt).getTime() < Date.now())) e.expectedAt = 'Choose a future time';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const purpose = f.detail.trim() ? (f.purpose === 'Other' ? f.detail.trim() : `${f.purpose} — ${f.detail.trim()}`) : f.purpose;
    save.mutate({
      fullName: f.fullName.trim(), purpose, hostEmployeeId: f.hostEmployeeId,
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      ...(campusParam.campusId ? { campusId: campusParam.campusId } : {}),
      ...(mode === 'later' ? { expectedAt: localToIso(f.expectedAt) } : {}),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Visitor check-in" onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit}
      submitLabel={mode === 'now' ? 'Print badge and check in' : 'Pre-approve visit'} submitIcon={mode === 'now' ? 'printer' : 'calendar'}>
      <div className="mb-4">
        <Segment<'now' | 'later'> items={[{ id: 'now', label: 'Arriving now' }, { id: 'later', label: 'Pre-approve for later' }]} active={mode} onChange={setMode} />
      </div>
      <div className="formsection">
        <div className="formsection__title">Visitor</div>
        <div className="form-grid">
          <TextField label="Visitor name" required value={f.fullName} onChange={set('fullName')} maxLength={120} error={fe.errors.fullName} />
          <TextField label="Phone" type="tel" value={f.phone} onChange={set('phone')} maxLength={16} error={fe.errors.phone} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Visit</div>
      <div className="form-grid">
        <SelectField label="Purpose" required value={f.purpose} onChange={set('purpose')} options={VISIT_PURPOSES} />
        <SelectField label="Host" required value={f.hostEmployeeId} onChange={set('hostEmployeeId')} placeholder="Choose a staff member" error={fe.errors.hostEmployeeId}
          options={(lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} />
        <TextField className="span-2" label={f.purpose === 'Other' ? 'Purpose details' : 'Details (optional)'} required={f.purpose === 'Other'}
          value={f.detail} onChange={set('detail')} maxLength={100} placeholder="e.g. Grade 8 parent meeting" error={fe.errors.detail} />
        {mode === 'later' && (
          <TextField label="Expected at" type="datetime-local" required value={f.expectedAt} onChange={set('expectedAt')} error={fe.errors.expectedAt} />
        )}
      </div>
      </div>
      <div className="mt-4 st-note">
        <Icon name="camera" size={20} />
        <span className="col"><span className="t-sm t-bold">ID capture</span><span className="t-micro t-muted">Check a photo ID at the desk. The host is notified as soon as the visitor is checked in.</span></span>
      </div>
    </FormModal>
  );
}

function BadgeModal({ visitor, onClose }: { visitor: Visitor; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Visitor badge ${visitor.badgeNo}`}
      foot={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon="printer" onClick={() => window.print()}>Print badge</Button></>}>
      <div className="st-badgecard">
        <div className="eyebrow">Holy Sai International School · Visitor</div>
        <div className="h1 mt-2 t-num">{visitor.badgeNo}</div>
        <div className="h3 mt-2">{visitor.fullName}</div>
        <div className="t-sm t-muted mt-2">{visitor.purpose}</div>
        <div className="t-sm mt-2">Host: <strong>{visitor.hostName ?? '—'}</strong></div>
        <div className="t-micro t-muted mt-2">{visitor.status === 'Expected' ? `Expected ${fmt.dateTime(visitor.checkedInAt)}` : `Checked in ${fmt.dateTime(visitor.checkedInAt)}`} · {visitor.campusName}</div>
      </div>
    </Modal>
  );
}
