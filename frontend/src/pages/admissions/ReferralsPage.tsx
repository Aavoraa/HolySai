import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Button, Card, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination, SearchInput, SelectField,
  Skeleton, Status, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { FormModal, useFieldErrors } from './LeadForms';
import { LeadProfileHost } from './LeadProfile';
import { PHONE_RE, stageTone, useLeadParam } from './shared';
import { GRADES } from './types';

interface Summary {
  kpis: { total: number; converted: number; conversion: number; families: number; parentBase: number; familiesPct: number; delta: number | null; cpa: number | null; rewardsCredited: number; rewardsPending: number };
  families: { parentId: string; parent: string; child: string | null; referred: number; converted: number; pending: number; credited: number; rewardCredited: number; recognition: string }[];
}
interface Referral {
  id: string; referredName: string; status: string; rewardStatus: string; rewardAmount: number; createdAt: string;
  parentId: string; parentName: string; enquiryId: string | null; leadCode: string | null; stage: string | null; grade: string | null;
}

export default function ReferralsPage() {
  const { can } = useAuth();
  const manage = can('admissions.manage');
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const { openLead } = useLeadParam();
  const s = useApiQuery<Summary>('/referrals/summary', campusParam);
  const list = useListParams({ sort: 'created', dir: 'desc', pageSize: 10 }, ['status', 'rewardStatus']);
  const q = usePagedQuery<Referral>('/referrals', { ...list.query, ...campusParam });
  const [adding, setAdding] = useState(false);
  const reward = useApiMutation<{ id: string }>('patch', (x) => `/referrals/${x.id}/reward`, {
    body: () => ({ rewardStatus: 'Credited' }), invalidate: ['/referrals', '/enquiries'],
  });
  const k = s.data?.kpis;

  const credit = async (r: Referral) => {
    const ok = await confirm({
      title: `Acknowledge ${r.parentName}?`,
      body: `Marks the recognition for referring ${r.referredName} as credited${r.rewardAmount ? ` (${fmt.money(r.rewardAmount)})` : ''}. This is recorded in the audit trail.`,
      confirmLabel: 'Mark credited', icon: 'award',
    });
    if (ok) reward.mutate({ id: r.id });
  };

  return (
    <Page>
      <PageHead title="Parent Referrals" sub="The highest-converting and lowest-cost channel the school has."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Record referral</Button>} />
      {s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="link" label="Referrals this year" value={k?.total ?? '—'} tone="teal" delta={k?.delta} loading={s.isLoading} foot="Last 90 days vs the 90 before" />
          <Kpi icon="userCheck" label="Converted" value={k?.converted ?? '—'} tone="teal" loading={s.isLoading} foot={k ? `${k.conversion}% conversion` : undefined} />
          <Kpi icon="users" label="Referring families" value={k?.families ?? '—'} loading={s.isLoading} foot={k ? `${k.familiesPct}% of parent base` : undefined} />
          <Kpi icon="rupee" label="Cost per admission" value={k?.cpa != null ? fmt.money(k.cpa) : '—'} tone="teal" loading={s.isLoading} foot="Referral channel" />
        </Grid>
      )}
      <div className="mt-4">
        <Card icon="grid" title="Referring families" flush sub={k ? `${fmt.money(k.rewardsCredited)} recognition credited · ${k.rewardsPending} pending` : undefined}>
          {s.isLoading ? <div className="card__body"><Skeleton height={120} /></div> : s.data?.families.length ? (
            <DataTable rows={s.data.families} rowKey={(r) => r.parentId}
              onRowClick={(r) => list.setQ(r.parent)}
              columns={[
                { key: 'parent', label: 'Referring parent', render: (r) => <span className="t-bold">{r.parent}</span> },
                { key: 'child', label: 'Their child', render: (r) => <span className="t-xs">{r.child ?? '—'}</span> },
                { key: 'referred', label: 'Referred', className: 'num' },
                { key: 'converted', label: 'Enrolled', className: 'num' },
                { key: 'recognition', label: 'Recognition', render: (r) => <Badge tone={r.recognition === 'Acknowledged' ? 'success' : r.recognition === 'Pending' ? 'warning' : 'neutral'}>{r.recognition}</Badge> },
              ]} />
          ) : <Empty icon="link" title="No referrals yet" sub="Families who refer others appear here once a referral is recorded." />}
        </Card>
      </div>
      <div className="mt-4">
        <Card icon="grid" title="All referrals" flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search parent, child or reference" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(x) => list.setFilter('status', x)} options={['Submitted', 'Contacted', 'Enrolled', 'Lost']} />
            <FilterSelect label="Recognition" value={list.filters.rewardStatus} onChange={(x) => list.setFilter('rewardStatus', x)} options={['Pending', 'Credited', 'Not eligible']} />
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
              onRowClick={(r) => r.leadCode && openLead(r.leadCode)}
              emptyText={list.hasFilters ? 'No referrals match the current filters.' : 'No referrals yet. Use “Record referral” when a parent recommends a family.'}
              columns={[
                { key: 'created', label: 'Received', render: (r) => fmt.date(r.createdAt) },
                { key: 'parent', label: 'Referred by', render: (r) => r.parentName },
                { key: 'referredName', label: 'Family referred', render: (r) => <>{r.referredName}<div className="t-micro t-muted">{[r.leadCode, r.grade].filter(Boolean).join(' · ') || 'Not yet a lead'}</div></> },
                { key: 'stage', label: 'Lead stage', sortable: false, render: (r) => (r.stage ? <Badge tone={stageTone(r.stage)}>{r.stage}</Badge> : '—') },
                { key: 'status', label: 'Referral', render: (r) => <Status value={r.status} /> },
                {
                  key: 'reward', label: 'Recognition', sortable: false, render: (r) => (
                    <span className="row g-2" onClick={(e) => e.stopPropagation()}>
                      <Status value={r.rewardStatus} />
                      {manage && r.rewardStatus === 'Pending' && <Button size="sm" icon="award" loading={reward.isPending && reward.variables?.id === r.id} onClick={() => credit(r)}>Acknowledge</Button>}
                    </span>
                  ),
                },
              ]} />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} />
        </Card>
      </div>
      {adding && <ReferralModal onClose={() => setAdding(false)} onLead={(code) => { setAdding(false); if (code) openLead(code); }} />}
      <LeadProfileHost />
    </Page>
  );
}

function ReferralModal({ onClose, onLead }: { onClose: () => void; onLead: (code: string | null) => void }) {
  const { lookups } = useLookups();
  const school = useSchool();
  const fe = useFieldErrors();
  const [term, setTerm] = useState('');
  const parents = useApiQuery<{ id: string; fullName: string; parentCode: string; children: string | null }[]>(term.length >= 2 ? '/referrals/referrers' : null, { q: term });
  const [v, setV] = useState({ referrerParentId: '', referrerName: '', referredName: '', createLead: true, campusId: school.campusId ?? '', parentName: '', phone: '', gradeApplied: '' });
  const set = (k: keyof typeof v, val: string | boolean) => { setV((s) => ({ ...s, [k]: val })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>, { leadCode: string | null }>('post', '/referrals', {
    invalidate: ['/referrals', '/enquiries', '/admissions'], error: false,
    success: (r) => (r.data.leadCode ? `Referral recorded — lead ${r.data.leadCode} created` : 'Referral recorded'),
    onSuccess: (r) => onLead(r.data.leadCode),
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!v.referrerParentId) e.referrerParentId = 'Choose the referring parent';
    if (v.referredName.trim().length < 2) e.referredName = 'Enter the child’s name';
    if (v.createLead) {
      if (!v.campusId) e['lead.campusId'] = 'Choose a campus';
      if (v.parentName.trim().length < 2) e['lead.parentName'] = 'Enter the parent’s name';
      if (!PHONE_RE.test(v.phone.trim())) e['lead.phone'] = 'Enter a valid phone number';
      if (!v.gradeApplied) e['lead.gradeApplied'] = 'Choose a grade';
    }
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      referrerParentId: v.referrerParentId, referredName: v.referredName.trim(), createLead: v.createLead,
      lead: v.createLead ? { campusId: v.campusId, parentName: v.parentName.trim(), phone: v.phone.trim(), gradeApplied: v.gradeApplied } : undefined,
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Record a parent referral" sub="Creates a Referral lead so the family enters the pipeline straight away." onClose={onClose}
      busy={save.isPending} error={save.error} fieldErrors={fe.errors} submitLabel="Record referral" formId="ref-form" size="wide">
      <form id="ref-form" onSubmit={submit} noValidate className="col g-4">
        {v.referrerParentId ? (
          <div className="card card--tint adm-picked">
            <span className="t-sm">Referred by <strong>{v.referrerName}</strong></span>
            <Button size="sm" variant="quiet" onClick={() => setV((s) => ({ ...s, referrerParentId: '', referrerName: '' }))}>Change</Button>
          </div>
        ) : (
          <div className="field">
            <span className="label">Referring parent <span className="req">*</span></span>
            <SearchInput value={term} onSearch={setTerm} placeholder="Search parent name or PAR- code" maxWidth={9999} />
            {fe.errors.referrerParentId && <span className="hint hint--error" role="alert">{fe.errors.referrerParentId}</span>}
            {term.length >= 2 && (
              <div className="adm-picklist">
                {parents.isLoading && <span className="t-xs t-muted">Searching…</span>}
                {parents.data && !parents.data.length && <span className="t-xs t-muted">No parents match.</span>}
                {parents.data?.map((p) => (
                  <button key={p.id} type="button" className="btn btn--quiet"
                    onClick={() => { setV((s) => ({ ...s, referrerParentId: p.id, referrerName: p.fullName })); fe.clear('referrerParentId'); }}>
                    <strong>{p.fullName}</strong>&nbsp;<span className="t-muted">{p.parentCode}{p.children ? ` · ${p.children}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <TextField label="Child being referred" required value={v.referredName} onChange={(x) => set('referredName', x)} error={fe.errors.referredName} maxLength={120} />
        <Checkbox checked={v.createLead} onChange={(x) => set('createLead', x)} label="Create a lead now" />
        {v.createLead && (
          <div className="form-grid">
            <TextField label="Parent name" required value={v.parentName} onChange={(x) => { set('parentName', x); fe.clear('lead.parentName'); }} error={fe.errors['lead.parentName']} maxLength={120} />
            <TextField label="Phone" required type="tel" value={v.phone} onChange={(x) => { set('phone', x); fe.clear('lead.phone'); }} error={fe.errors['lead.phone']} />
            <SelectField label="Campus" required value={v.campusId} onChange={(x) => { set('campusId', x); fe.clear('lead.campusId'); }} error={fe.errors['lead.campusId']} placeholder="Select…"
              options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            <SelectField label="Grade" required value={v.gradeApplied} onChange={(x) => { set('gradeApplied', x); fe.clear('lead.gradeApplied'); }} error={fe.errors['lead.gradeApplied']} placeholder="Select…" options={GRADES} />
          </div>
        )}
      </form>
    </FormModal>
  );
}
