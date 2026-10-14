import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Banner, Button, Card, DataTable, Dl, Empty, ErrorState, FilterSelect, Flow, Grid, Icon, Kpi, Page, PageHead, Pagination,
  SearchInput, SelectField, Status, StudentLink, TextArea,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { FormModal, IncidentModal, incidentRowClass, SeverityBadge, useFieldErrors } from './shared';
import { INCIDENT_STATUSES, INCIDENT_TYPES, SEVERITIES, type Incident, type IncidentSummary } from './types';

export default function SafeguardingPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const manage = can('safety.manage');
  const list = useListParams({ sort: 'date', dir: 'desc', pageSize: 25 }, ['type', 'status', 'severity']);
  const summary = useApiQuery<IncidentSummary>('/incidents/summary', campusParam);
  const q = usePagedQuery<Incident>('/incidents', { ...list.query, ...campusParam });
  const [logging, setLogging] = useState(false);
  const [open, setOpen] = useState<Incident | null>(null);
  const s = summary.data;

  return (
    <Page>
      <PageHead
        title="Safeguarding"
        sub="Restricted module. Concerns are logged the same day and reviewed by the Designated Safeguarding Lead within 24 hours."
        actions={manage && <Button variant="primary" icon="shield" onClick={() => setLogging(true)}>Log a concern</Button>}
      />
      <Banner tone="warning" icon="lock">
        <strong>Access is restricted.</strong> Only the Designated Safeguarding Lead, the Principal and the counsellor can open confidential records. Every view is recorded in the audit trail.
        {s && !s.canViewConfidential && ' Confidential records are hidden from your role.'}
      </Banner>

      {summary.error ? <div className="mt-4"><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></div> : (
        <Grid cols="g-4col" className="mt-4">
          <Kpi icon="alert" loading={!s} label="Open concerns" value={fmt.n(s?.openConcerns ?? 0)} tone={s?.openConcerns ? 'amber' : 'teal'} foot={s ? `${s.underReview} under DSL review` : undefined} />
          <Kpi icon="activity" loading={!s} label="Closed this year" value={fmt.n(s?.closedThisYear ?? 0)} foot={s ? `${s.closedWithin24h} within 24 h of being raised` : undefined} />
          <Kpi icon="alert" loading={!s} label="Open incidents (all types)" value={fmt.n(s?.openAll ?? 0)} tone="info" foot={s ? `${s.last30Days} logged in the last 30 days` : undefined} />
          <Kpi icon="clock" loading={!s} label="Escalated / referred" value={fmt.n(s?.escalated ?? 0)} tone={s?.escalated ? 'critical' : undefined} foot="Principal informed for every referral" />
        </Grid>
      )}

      <div className="mt-4">
        <Card icon="grid" title="Escalation path">
          <Flow steps={[
            { label: 'Concern observed', meta: 'Any staff member', state: 'done' },
            { label: 'Logged same day', meta: 'Within the system, not on paper', state: 'done' },
            { label: 'DSL review', meta: 'Within 24 hours', state: 'active' },
            { label: 'Decision', meta: 'Record only, support plan, or referral' },
            { label: 'Principal informed', meta: 'For every external referral' },
          ]} />
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="checkSquare" title="Incident register" sub="Safeguarding, health, transport, facilities, security and emergency events" flush>
          <div className="toolbar">
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search reference or summary" />
            <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} options={INCIDENT_TYPES} />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={INCIDENT_STATUSES} />
            <FilterSelect label="Severity" value={list.filters.severity} onChange={(v) => list.setFilter('severity', v)} options={SEVERITIES} />
            {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear</Button>}
          </div>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading || q.isFetching}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              onRowClick={setOpen}
              rowClassName={incidentRowClass}
              emptyText="No incidents match these filters."
              columns={[
                { key: 'code', label: 'Ref', render: (r) => <span className="t-num t-bold">{r.code}</span> },
                { key: 'date', label: 'Date', render: (r) => fmt.date(r.occurredOn) },
                { key: 'type', label: 'Type', render: (r) => r.incidentType },
                { key: 'summary', label: 'Summary', sortable: false, render: (r) => <span className="row g-1">{r.isConfidential && <Icon name="lock" size={12} className="t-critical" />}{r.summary}</span> },
                { key: 'student', label: 'Student', sortable: false, render: (r) => r.studentId && r.studentName ? <StudentLink id={r.studentId} name={r.studentName} meta={r.admissionNo ?? undefined} /> : <span className="t-faint">—</span> },
                { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge value={r.severity} /> },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                { key: 'owner', label: 'Owner', render: (r) => r.ownerName ?? '—' },
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="grid" title="Training and compliance" sub="Child protection, background checks and fire safety" flush>
          {!s ? null : !s.compliance.length ? <Empty icon="clipboard" title="No safeguarding compliance items" sub="Compliance items are managed in Operations." /> : (
            <DataTable
              rows={s.compliance}
              rowKey={(r) => r.id}
              columns={[
                { key: 'item', label: 'Requirement', render: (r) => <><div>{r.item}</div><div className="t-micro t-muted">{r.authority}</div></> },
                { key: 'owner', label: 'Owner' },
                { key: 'due', label: 'Due', render: (r) => fmt.date(r.dueOn) },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              ]}
            />
          )}
        </Card>
      </div>

      {logging && <IncidentModal onClose={() => setLogging(false)} />}
      {open && <IncidentDetail incident={open} canManage={manage} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function IncidentDetail({ incident, canManage, onClose }: { incident: Incident; canManage: boolean; onClose: () => void }) {
  const { lookups } = useLookups();
  // Re-read the record so confidential views are audited server-side.
  const q = useApiQuery<Incident>(`/incidents/${incident.id}`);
  const r = q.data ?? incident;
  const [f, setF] = useState({ status: incident.status as string, severity: incident.severity as string, ownerId: incident.ownerId ?? '', note: '' });
  const fe = useFieldErrors();
  const save = useApiMutation<Record<string, unknown>>('patch', `/incidents/${incident.id}`, { invalidate: ['/incidents', '/gate'], onSuccess: onClose });
  const submit = () => {
    const body: Record<string, unknown> = {};
    if (f.status !== r.status) body.status = f.status;
    if (f.severity !== r.severity) body.severity = f.severity;
    if ((f.ownerId || null) !== (r.ownerId ?? null)) body.ownerId = f.ownerId || null;
    if (f.note.trim()) body.details = `${r.details ? `${r.details}\n\n` : ''}${fmt.dateTime(new Date())}: ${f.note.trim()}`;
    if (!Object.keys(body).length) return fe.setErrors({ note: 'Change the status, severity or owner, or add a note' });
    save.mutate(body, { onError: fe.fromServer });
  };
  const content = (
    <div className="col g-4">
      {r.isConfidential && <Banner tone="warning" icon="lock">Confidential record. This view has been logged.</Banner>}
      <Dl items={[
        ['Type', r.incidentType],
        ['Date', fmt.date(r.occurredOn)],
        ['Severity', <SeverityBadge key="s" value={r.severity} />],
        ['Status', <Status key="st" value={r.status} />],
        ['Student', r.studentId && r.studentName ? <StudentLink key="stu" id={r.studentId} name={r.studentName} /> : '—'],
        ['Owner', r.ownerName ?? '—'],
        ['Logged by', `${r.createdByName ?? '—'} · ${fmt.dateTime(r.createdAt)}`],
      ]} />
      <div>
        <div className="label mb-2">Details</div>
        <p className="t-sm st-pre">{q.isLoading ? 'Loading…' : r.details ?? 'No details recorded.'}</p>
      </div>
      {canManage && (
        <div className="formsection">
        <div className="formsection__title">Update the record</div>
        <div className="form-grid">
          <SelectField label="Status" value={f.status} onChange={(v) => setF((x) => ({ ...x, status: v }))} options={INCIDENT_STATUSES} />
          <SelectField label="Severity" value={f.severity} onChange={(v) => setF((x) => ({ ...x, severity: v }))} options={SEVERITIES} />
          <SelectField className="span-2" label="Owner" value={f.ownerId} onChange={(v) => setF((x) => ({ ...x, ownerId: v }))} placeholder="Unassigned"
            options={(lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} />
          <TextArea className="span-2" label="Add a note" rows={3} maxLength={1000} value={f.note} error={fe.errors.note}
            onChange={(v) => { setF((x) => ({ ...x, note: v })); fe.clear('note'); }} placeholder="Action taken, decision, referral…" />
        </div>
        </div>
      )}
    </div>
  );
  return (
    <FormModal title={`${r.code} · ${r.summary}`} size="wide" onClose={onClose} busy={save.isPending}
      error={save.error ?? q.error} fieldErrors={fe.errors} onSubmit={canManage ? submit : onClose}
      submitLabel={canManage ? 'Save changes' : 'Close'}>
      {content}
    </FormModal>
  );
}
