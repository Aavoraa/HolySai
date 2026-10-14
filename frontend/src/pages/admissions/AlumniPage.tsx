import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Button, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination, Person,
  SearchInput, SelectField, Skeleton, TextField, Toolbar,
} from '@/components/ui';
import { FormModal, useFieldErrors } from './LeadForms';
import { EMAIL_RE, PHONE_RE } from './shared';
import type { Named } from './types';

interface Alumnus {
  id: string; fullName: string; batchYear: number; university: string | null; career: string | null; email: string | null; phone: string | null;
  engagement: 'High' | 'Medium' | 'Low'; lastEngagement: string | null;
}
interface Summary { total: number; engaged: number; engagedPct: number; mentoring: number; referrals: number; latestBatch: number | null; destinations: Named[]; byBatch: Named[] }

const ENG_TONE = { High: 'success', Medium: 'info', Low: 'neutral' } as const;

export default function AlumniPage() {
  const { can } = useAuth();
  const manage = can('crm.manage');
  const s = useApiQuery<Summary>('/alumni/summary');
  const list = useListParams({ sort: 'engagement', dir: 'asc' }, ['engagement', 'batch']);
  const q = usePagedQuery<Alumnus>('/alumni', list.query);
  const [editing, setEditing] = useState<Alumnus | 'new' | null>(null);
  const d = s.data;
  const batches = (d?.byBatch ?? []).map((b) => String(b.label)).reverse();

  return (
    <Page>
      <PageHead title="Alumni" sub="Relationships continue after graduation. Alumni mentor Innovation Lab projects and refer families."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add alumnus</Button>} />
      {s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="graduation" label="Alumni on record" value={d?.total ?? '—'} loading={s.isLoading} foot={d?.latestBatch ? `Latest batch ${d.latestBatch}` : undefined} />
          <Kpi icon="activity" label="Actively engaged" value={d?.engaged ?? '—'} unit={d ? `${d.engagedPct}%` : undefined} tone="teal" loading={s.isLoading}
            onClick={() => list.setFilter('engagement', 'High')} foot="High or medium engagement" />
          <Kpi icon="lightbulb" label="Mentoring students" value={d?.mentoring ?? '—'} tone="amber" loading={s.isLoading} />
          <Kpi icon="link" label="Referrals from alumni" value={d?.referrals ?? '—'} tone="info" loading={s.isLoading} foot="This year" />
        </Grid>
      )}
      <div className="grid g-main mt-4">
        <Card icon="grid" title="Alumni directory" flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name, university or career" />
            <FilterSelect label="Engagement" value={list.filters.engagement} onChange={(x) => list.setFilter('engagement', x)} options={['High', 'Medium', 'Low']} />
            <FilterSelect label="Batch" value={list.filters.batch} onChange={(x) => list.setFilter('batch', x)} options={batches} />
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
              onRowClick={manage ? (r) => setEditing(r) : undefined}
              emptyText={list.hasFilters ? 'No alumni match the current filters.' : (manage ? 'No alumni on record yet. Use “Add alumnus” to start the directory.' : 'No alumni on record yet.')}
              columns={[
                { key: 'name', label: 'Alumnus', render: (r) => <Person name={r.fullName} meta={`Batch of ${r.batchYear}`} /> },
                { key: 'university', label: 'University', render: (r) => r.university ?? '—' },
                { key: 'career', label: 'Now', sortable: false, render: (r) => r.career ?? '—' },
                { key: 'engagement', label: 'Engagement', render: (r) => <Badge tone={ENG_TONE[r.engagement]}>{r.engagement}</Badge> },
                { key: 'last', label: 'Last interaction', sortable: false, render: (r) => <span className="t-xs">{r.lastEngagement ?? '—'}</span> },
              ]} />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
        <Card icon="grid" title="Destinations" sub="Where the last five batches went">
          {s.isLoading ? <Skeleton height={220} /> : d?.destinations.length
            ? <Chart svg={charts.hbar({ rows: d.destinations.map((x, i) => ({ label: x.label, value: x.value, color: ['var(--navy)', 'var(--teal)', 'var(--amber)', 'var(--viz-8)'][i % 4] })), labelW: 190, rowH: 32, label: 'Alumni destinations' })} />
            : <Empty icon="graduation" title="No destinations recorded" />}
        </Card>
      </div>
      {editing && <AlumnusModal alumnus={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function AlumnusModal({ alumnus, onClose }: { alumnus: Alumnus | null; onClose: () => void }) {
  const fe = useFieldErrors();
  const [v, setV] = useState({
    fullName: alumnus?.fullName ?? '', batchYear: String(alumnus?.batchYear ?? new Date().getFullYear() - 1), university: alumnus?.university ?? '',
    career: alumnus?.career ?? '', email: alumnus?.email ?? '', phone: alumnus?.phone ?? '', engagement: alumnus?.engagement ?? 'Low',
    lastEngagement: alumnus?.lastEngagement ?? '',
  });
  const set = (k: keyof typeof v, val: string) => { setV((s) => ({ ...s, [k]: val })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>(alumnus ? 'patch' : 'post', alumnus ? `/alumni/${alumnus.id}` : '/alumni', {
    invalidate: ['/alumni'], error: false, onSuccess: onClose,
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const year = Number(v.batchYear);
    if (v.fullName.trim().length < 2) e.fullName = 'Enter a name';
    if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear()) e.batchYear = 'Enter a valid batch year';
    if (v.email && !EMAIL_RE.test(v.email)) e.email = 'Enter a valid email';
    if (v.phone && !PHONE_RE.test(v.phone)) e.phone = 'Enter a valid phone number';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const opt = (x: string) => x.trim() || undefined;
    save.mutate({
      fullName: v.fullName.trim(), batchYear: year, university: opt(v.university), career: opt(v.career), email: opt(v.email),
      phone: opt(v.phone), engagement: v.engagement, lastEngagement: opt(v.lastEngagement),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={alumnus ? `Edit ${alumnus.fullName}` : 'Add alumnus'} onClose={onClose} busy={save.isPending} error={save.error}
      fieldErrors={fe.errors} submitLabel={alumnus ? 'Save changes' : 'Add alumnus'} formId="alumni-form" size="wide">
      <form id="alumni-form" onSubmit={submit} noValidate>
        <div className="formsection">
          <div className="formsection__title">Alumnus</div>
          <div className="form-grid">
            <TextField label="Full name" required value={v.fullName} onChange={(x) => set('fullName', x)} error={fe.errors.fullName} maxLength={120} autoFocus />
            <TextField label="Batch year" required type="number" value={v.batchYear} onChange={(x) => set('batchYear', x)} error={fe.errors.batchYear} />
            <TextField label="University" value={v.university} onChange={(x) => set('university', x)} maxLength={120} />
            <TextField label="Now" value={v.career} onChange={(x) => set('career', x)} maxLength={120} placeholder="Role, organisation or course" />
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Contact and engagement</div>
          <div className="form-grid">
            <TextField label="Email" type="email" value={v.email} onChange={(x) => set('email', x)} error={fe.errors.email} />
            <TextField label="Phone" type="tel" value={v.phone} onChange={(x) => set('phone', x)} error={fe.errors.phone} />
            <SelectField label="Engagement" value={v.engagement} onChange={(x) => set('engagement', x)} options={['High', 'Medium', 'Low']} />
            <TextField label="Last interaction" value={v.lastEngagement} onChange={(x) => set('lastEngagement', x)} maxLength={160} placeholder="e.g. Career talk — Aug 2026" />
          </div>
        </div>
      </form>
    </FormModal>
  );
}
