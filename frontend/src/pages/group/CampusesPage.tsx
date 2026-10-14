import { useState } from 'react';
import { Badge, Button, Card, Dl, Empty, ErrorState, Icon, InlineError, Modal, Page, PageHead, Skeleton, TextArea, TextField } from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { FormGrid, req, useForm } from '../operations/shared';
import type { CampusMetrics } from './shared';

export default function CampusesPage() {
  const q = useApiQuery<CampusMetrics[]>('/group/campuses');
  const school = useSchool();
  const { can } = useAuth();
  const [edit, setEdit] = useState<CampusMetrics | null>(null);
  const campuses = q.data ?? [];
  return (
    <Page>
      <PageHead title="Campuses" sub={q.data ? `The ${campuses.length} ${campuses.length === 1 ? 'campus' : 'campuses'} in the Holy Sai group.` : 'The campuses in the Holy Sai group.'}
        actions={can('dashboard.group') && <Button variant="primary" icon="globe" to="/group-dashboard">Group dashboard</Button>} />
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isLoading ? (
        <div className="grid g-3col g-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={340} style={{ borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : !campuses.length ? (
        <Card><Empty icon="building" title="No campuses yet" sub="Campuses are created during school setup. Once added, each one appears here with its live figures." /></Card>
      ) : (
        <div className="grid g-3col g-4">
          {campuses.map((c) => {
            const current = school.scope === 'campus' && school.campusId === c.id;
            return (
              <Card key={c.id}>
                <div className="row-top g-3">
                  <span className="avatar avatar--lg none" aria-hidden="true"><Icon name="building" size={24} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row g-2 wrap"><span className="h3">{c.name}</span>{current && <Badge tone="success" dot>Current</Badge>}</div>
                    <div className="t-xs t-muted mt-1">{c.code} · {c.place} · since {c.established ?? '—'}</div>
                  </div>
                </div>
                <div className="mt-4">
                  <Dl items={[
                    ['Curriculum', c.curriculum ?? '—'],
                    ['Students', <span className="t-num">{fmt.n(c.students)}</span>],
                    ['Staff', <span className="t-num">{c.staffTarget ? `${fmt.n(c.staff)} of ${fmt.n(c.staffTarget)}` : fmt.n(c.staff)}</span>],
                    ['Attendance', <span className="t-num">{fmt.pct(c.attendancePct, 1)}</span>],
                    ['Fee collection', <span className="t-num">{fmt.pct(c.collectionPct, 1)}</span>],
                    ['Parent NPS', <span className="t-num">{c.nps != null ? fmt.n(c.nps) : '—'}</span>],
                  ]} />
                </div>
                {c.address && <p className="t-xs t-muted mt-3"><Icon name="mapPin" size={12} /> {c.address}</p>}
                <div className="col g-2 mt-4">
                  <Button block icon={current ? 'check' : 'refresh'} disabled={current} onClick={() => school.setCampus(c.id)}>
                    {current ? 'Current campus' : 'Switch to this campus'}
                  </Button>
                  {can('group.manage') && <Button block variant="quiet" icon="edit" onClick={() => setEdit(c)}>Edit details</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <EditCampus campus={edit} onClose={() => setEdit(null)} />}
    </Page>
  );
}

function EditCampus({ campus, onClose }: { campus: CampusMetrics; onClose: () => void }) {
  const f = useForm({
    name: campus.name, shortName: campus.shortName, place: campus.place, curriculum: campus.curriculum ?? '', address: campus.address ?? '',
    established: campus.established ? String(campus.established) : '', staffingTarget: campus.staffTarget ? String(campus.staffTarget) : '',
  });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('put', `/group/campuses/${campus.id}`, { invalidate: ['/group', '/lookups'], success: 'Campus updated' });
  const year = new Date().getFullYear();
  const submit = async () => {
    if (!f.validate({
      name: req(v.name, 'Name'), shortName: req(v.shortName, 'Short name'), place: req(v.place, 'Place'),
      established: v.established && !(Number(v.established) >= 1900 && Number(v.established) <= year) ? `Enter a year between 1900 and ${year}` : null,
      staffingTarget: v.staffingTarget && !(Number.isInteger(Number(v.staffingTarget)) && Number(v.staffingTarget) >= 1) ? 'Enter a whole number of positions' : null,
    })) return;
    try {
      await save.mutateAsync({
        name: v.name.trim(), shortName: v.shortName.trim(), place: v.place.trim(), curriculum: v.curriculum || null, address: v.address || null,
        ...(v.established ? { established: Number(v.established) } : {}), ...(v.staffingTarget ? { staffingTarget: Number(v.staffingTarget) } : {}),
      });
      onClose();
    } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${campus.shortName}`} sub="Changes apply across the application and are audited." busy={save.isPending} size="wide"
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save changes</Button></>}>
      {save.error && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Identity</div>
        <FormGrid>
          <TextField label="Campus name" required maxLength={120} value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} />
          <TextField label="Short name" required maxLength={40} value={v.shortName} onChange={(x) => f.set('shortName', x)} error={f.errors.shortName}
            hint="Shown in switchers and comparison tables" />
          <TextField label="Place" required maxLength={80} value={v.place} onChange={(x) => f.set('place', x)} error={f.errors.place} />
          <TextField label="Established" type="number" min={1900} max={year} value={v.established} onChange={(x) => f.set('established', x)} error={f.errors.established} />
        </FormGrid>
        <div className="mt-3"><TextArea label="Address" rows={2} maxLength={300} value={v.address} onChange={(x) => f.set('address', x)} /></div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Academics and staffing</div>
        <FormGrid>
          <TextField label="Curriculum" maxLength={160} value={v.curriculum} onChange={(x) => f.set('curriculum', x)} />
          <TextField label="Approved staff positions" type="number" min={1} value={v.staffingTarget} onChange={(x) => f.set('staffingTarget', x)}
            error={f.errors.staffingTarget} hint="Used for the Staff filled measure" />
        </FormGrid>
      </div>
    </Modal>
  );
}
