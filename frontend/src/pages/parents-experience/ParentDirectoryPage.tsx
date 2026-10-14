import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, DataTable, Dl, ErrorState, FilterSelect, Grid, Kpi, Meter, Modal, Page, PageHead, Pagination,
  Person, SearchInput, SelectField, Skeleton, Status, StudentLink, Tabs, TextArea, TextField, Timeline, Toolbar,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import {
  ChannelBadge, EmptyHistory, LogInteractionModal, SendMessageModal, engagementTone, fieldErrorsOf, lastContact,
} from './shared';
import type { Communication, DirectoryRow, DirectorySummary, ParentChild, ParentRecord } from './types';

export default function ParentDirectoryPage() {
  const list = useListParams({ sort: 'name' }, ['engagement', 'ptm', 'app', 'gradeLevel']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const { lookups } = useLookups();
  const [sp, setSp] = useSearchParams();
  const openId = sp.get('parent');
  const [messageTo, setMessageTo] = useState<DirectoryRow | null>(null);
  const [form, setForm] = useState<{ open: boolean; parent?: ParentRecord | null }>({ open: false });

  const summary = useApiQuery<DirectorySummary>('/parent-directory/summary', campusParam);
  const q = usePagedQuery<DirectoryRow>('/parent-directory', { ...list.query, ...campusParam });
  const s = summary.data;
  const pct = (n: number | undefined) => (s && s.parents ? Math.round(((n ?? 0) / s.parents) * 100) : 0);
  const levels = Array.from(new Set((lookups?.classes ?? []).map((c) => c.gradeLevel))).sort((a, b) => a - b);

  const openProfile = (id: string | null) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('parent', id); else next.delete('parent');
    return next;
  }, { replace: true });

  return (
    <Page>
      <PageHead
        title="Parent Directory"
        sub="Contact details, children, engagement and the last interaction — the parent side of the CRM."
        actions={can('parents.manage') && <Button variant="primary" icon="plus" onClick={() => setForm({ open: true, parent: null })}>Add parent</Button>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
        <Grid cols="g-4col">
          <Kpi icon="phone" label="Parent accounts" loading={summary.isLoading} value={fmt.n(s?.appAccounts)} foot={`${pct(s?.appAccounts)}% of ${fmt.n(s?.parents)} families use the app`} onClick={() => list.setFilter('app', 'yes')} />
          <Kpi icon="heart" label="High engagement" tone="teal" loading={summary.isLoading} value={`${pct(s?.high)}%`} foot={`${fmt.n(s?.high)} families scoring 70 or more`} onClick={() => list.setFilter('engagement', 'high')} />
          <Kpi icon="alertCircle" label="Low engagement" tone="amber" loading={summary.isLoading} value={fmt.n(s?.low)} foot={`Score below 50 · ${fmt.n(s?.noContact30d)} not contacted in 30 days`} onClick={() => list.setFilter('engagement', 'low')} />
          <Kpi icon="activity" label="Average engagement" tone="teal" loading={summary.isLoading} value={fmt.n(s?.averageEngagement)} unit="/ 100" foot={`${fmt.n(s?.contacted7d)} families contacted this week`} />
        </Grid>
      )}

      <Card flush className="mt-4">
        <Toolbar>
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search by name, phone, email or code" />
        <FilterSelect label="Engagement" value={list.filters.engagement} onChange={(v) => list.setFilter('engagement', v)}
          options={[{ value: 'high', label: 'High (70+)' }, { value: 'medium', label: 'Medium (50–69)' }, { value: 'low', label: 'Low (below 50)' }]} />
        <FilterSelect label="PTM" value={list.filters.ptm} onChange={(v) => list.setFilter('ptm', v)}
          options={[{ value: 'booked', label: 'Booked' }, { value: 'not_booked', label: 'Not booked' }]} />
        <FilterSelect label="App" value={list.filters.app} onChange={(v) => list.setFilter('app', v)}
          options={[{ value: 'yes', label: 'Uses the app' }, { value: 'no', label: 'No app account' }]} />
        <FilterSelect label="Grade" value={list.filters.gradeLevel} onChange={(v) => list.setFilter('gradeLevel', v)}
          options={levels.map((g) => ({ value: String(g), label: `Grade ${g}` }))} />
        {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
        <div className="spacer" />
        <span className="t-sm t-muted t-num">{q.data ? `${fmt.n(q.data.meta.total)} ${list.hasFilters ? 'matching' : 'families'}` : ''}</span>
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<DirectoryRow>
            rows={q.data?.rows}
            loading={q.isLoading || q.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => openProfile(r.id)}
            emptyText={list.hasFilters ? 'No parents match the current filters.' : 'No parent records yet. Parents are added with each admission, or use “Add parent”.'}
            columns={[
              { key: 'name', label: 'Parent', render: (r) => <Person name={r.fullName} meta={r.phone} onClick={() => openProfile(r.id)} /> },
              {
                key: 'children', label: 'Children', sortable: false, render: (r) => r.children.length ? (
                  <div className="col g-1">{r.children.map((c) => <StudentLink key={c.id} id={c.id} name={c.fullName} meta={`${c.grade ?? ''}${c.section ?? ''}`} />)}</div>
                ) : <span className="t-faint">None linked</span>,
              },
              { key: 'engagement', label: 'Engagement', width: '160px', render: (r) => <Meter label="" value={r.engagement} right={`${r.engagement}%`} tone={engagementTone(r.engagement)} /> },
              {
                key: 'lastContact', label: 'Last interaction', render: (r) => (
                  <span className="col"><span className="t-sm">{lastContact(r.lastContactChannel, r.lastContactAt)}</span>
                    {r.openQueries > 0 && <span className="t-micro t-critical">{r.openQueries} awaiting reply</span>}</span>
                ),
              },
              { key: 'ptm', label: 'PTM', sortable: false, render: (r) => <Badge tone={r.ptmBooked ? 'success' : 'warning'}>{r.ptmBooked ? 'Booked' : 'Not booked'}</Badge> },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => can('communication.send') ? (
                  <Button size="sm" icon="message" onClick={(e) => { e.stopPropagation(); setMessageTo(r); }}>Message</Button>
                ) : null,
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <ParentProfileModal id={openId} onClose={() => openProfile(null)} onEdit={(p) => setForm({ open: true, parent: p })} />
      <SendMessageModal open={!!messageTo} onClose={() => setMessageTo(null)} parent={messageTo} />
      <ParentFormModal open={form.open} parent={form.parent ?? null} onClose={() => setForm({ open: false })} onSaved={(p) => openProfile(p.id)} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function ParentProfileModal({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (p: ParentRecord) => void }) {
  const { can } = useAuth();
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const [message, setMessage] = useState(false);
  const [log, setLog] = useState(false);
  useEffect(() => setTab('overview'), [id]);
  const parent = useApiQuery<ParentRecord>(id ? `/parents/${id}` : null);
  const children = useApiQuery<ParentChild[]>(id ? `/parents/${id}/children` : null);
  const dir = useApiQuery<DirectoryRow[]>(parent.data ? '/parent-directory' : null, { q: parent.data?.parentCode, pageSize: 10 });
  const history = usePagedQuery<Communication>(id && can('communication.read') ? '/communications' : null, { parentId: id ?? undefined, pageSize: 30, sort: 'occurredAt', dir: 'desc' });
  const p = parent.data;
  const row = dir.data?.find((r) => r.id === id) ?? null;

  return (
    <Modal open={!!id} onClose={onClose} size="wide" busy={message || log}
      title={p?.fullName ?? 'Parent'}
      sub={p ? `${p.parentCode} · ${p.hasAppAccount ? 'Uses the parent app' : 'No app account'}` : undefined}
      foot={p && <>
        {can('parents.manage') && <Button icon="edit" onClick={() => onEdit(p)}>Edit</Button>}
        {can('communication.send') && <Button icon="phone" onClick={() => setLog(true)} disabled={!row}>Log call</Button>}
        {can('communication.send') && <Button variant="primary" icon="message" onClick={() => setMessage(true)} disabled={!row}>Message</Button>}
      </>}>
      {parent.error ? <ErrorState error={parent.error} onRetry={parent.refetch} /> : !p ? (
        <div className="col g-3"><Skeleton height={20} width={240} /><Skeleton height={120} /></div>
      ) : (
        <div className="col g-4">
          <Tabs items={[{ id: 'overview', label: 'Overview' }, { id: 'history', label: 'Communication history', count: history.data?.meta.total }]}
            active={tab} onChange={setTab} />
          {tab === 'overview' ? (
            <>
              <div className="grid g-2col g-4">
                <Dl items={[
                  ['Phone', p.phone], ['Alternate phone', p.altPhone ?? '—'], ['Email', p.email ?? '—'],
                  ['Preferred channel', p.preferredChannel], ['Occupation', p.occupation ?? '—'], ['Address', p.address ?? '—'],
                ]} />
                <div className="col g-3">
                  <Meter label="Engagement" value={p.engagement} right={`${p.engagement} / 100`} tone={engagementTone(p.engagement)} lg />
                  <Dl items={[
                    ['Last interaction', lastContact(p.lastContactChannel, p.lastContactAt)],
                    ['PTM', row ? <Badge tone={row.ptmBooked ? 'success' : 'warning'}>{row.ptmBooked ? 'Booked' : 'Not booked'}</Badge> : '—'],
                    ['Awaiting reply', row ? String(row.openQueries) : '—'],
                  ]} />
                </div>
              </div>
              <div>
                <div className="eyebrow mb-2">Children</div>
                {children.isLoading ? <Skeleton height={48} /> : children.error ? <ErrorState error={children.error} onRetry={children.refetch} /> : children.data?.length ? (
                  <div className="col g-2">
                    {children.data.map((c) => (
                      <div key={c.id} className="card pe-child">
                        <StudentLink id={c.id} name={c.fullName} meta={`${c.admissionNo} · ${c.grade ?? ''}${c.section ?? ''} · ${c.relationship}${c.isPrimary ? ' (primary)' : ''}`} />
                        <div className="row g-3 wrap">
                          <span className="t-xs t-muted">Attendance <strong className="t-num">{fmt.pct(c.attendance)}</strong></span>
                          <span className="t-xs t-muted">Average <strong className="t-num">{c.average ?? '—'}</strong></span>
                          <Status value={c.risk} />
                          <Status value={c.feeStatus} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="t-sm t-muted">No children are linked to this parent.</p>}
              </div>
            </>
          ) : history.error ? <ErrorState error={history.error} onRetry={history.refetch} /> : history.isLoading ? <Skeleton height={160} /> : history.data?.rows.length ? (
            <Timeline items={history.data.rows.map((c) => ({
              time: fmt.dateTime(c.occurredAt),
              tone: c.needsReply ? 'critical' : c.direction === 'inbound' ? 'amber' : c.direction === 'internal' ? 'muted' : 'teal',
              title: <span className="row g-2 wrap"><ChannelBadge channel={c.channel} /> <span>{c.subject}</span>{c.needsReply && <Badge tone="critical">Awaiting reply</Badge>}</span>,
              body: <>
                {c.body && <div>{c.body}</div>}
                <div className="t-micro t-muted">
                  {c.direction === 'inbound' ? 'From the family' : c.direction === 'internal' ? `Note by ${c.sentBy ?? 'staff'}` : `Sent by ${c.sentBy ?? 'the school'}`}
                  {' · '}{c.status}{c.studentName ? ` · about ${c.studentName}` : ''}
                </div>
              </>,
            }))} />
          ) : <EmptyHistory />}
        </div>
      )}
      <SendMessageModal open={message} onClose={() => setMessage(false)} parent={row} />
      <LogInteractionModal open={log} onClose={() => setLog(false)} parent={row} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------
const PHONE = /^\+?[0-9 ]{8,16}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = { fullName: '', phone: '', altPhone: '', email: '', occupation: '', address: '', preferredChannel: 'whatsapp' };

function ParentFormModal({ open, parent, onClose, onSaved }: { open: boolean; parent: ParentRecord | null; onClose: () => void; onSaved: (p: ParentRecord) => void }) {
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setV(parent ? {
      fullName: parent.fullName, phone: parent.phone, altPhone: parent.altPhone ?? '', email: parent.email ?? '',
      occupation: parent.occupation ?? '', address: parent.address ?? '', preferredChannel: parent.preferredChannel,
    } : blank);
  }, [open, parent]);
  const set = (k: keyof typeof blank) => (val: string) => setV((x) => ({ ...x, [k]: val }));
  const save = useApiMutation<Record<string, string | undefined>, ParentRecord>(parent ? 'put' : 'post', parent ? `/parents/${parent.id}` : '/parents', {
    invalidate: ['/parent-directory', '/parents'],
    success: parent ? 'Parent updated' : 'Parent created',
    onSuccess: (r) => { onClose(); onSaved(r.data); },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (v.fullName.trim().length < 2) e.fullName = 'Enter the parent’s full name';
    if (!PHONE.test(v.phone.trim())) e.phone = 'Enter a valid phone number, e.g. +91 98407 22110';
    if (v.altPhone.trim() && !PHONE.test(v.altPhone.trim())) e.altPhone = 'Enter a valid phone number';
    if (v.email.trim() && !EMAIL.test(v.email.trim())) e.email = 'Enter a valid email address';
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || undefined]));
    save.mutate(body, { onError: (err) => setErrors(fieldErrorsOf(err)) });
  };
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} size="wide"
      title={parent ? `Edit ${parent.fullName}` : 'Add parent'}
      sub={parent ? parent.parentCode : 'Children are linked from the student record (Student 360 → Family)'}
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" icon="save" onClick={submit} loading={save.isPending}>{parent ? 'Save changes' : 'Create parent'}</Button>
      </>}>
      <div className="formsection">
        <div className="formsection__title">Contact</div>
        <div className="form-grid">
        <TextField label="Full name" required value={v.fullName} onChange={set('fullName')} error={errors.fullName} maxLength={120} autoFocus />
        <SelectField label="Preferred channel" value={v.preferredChannel} onChange={set('preferredChannel')}
          options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' }, { value: 'push', label: 'App notification' }, { value: 'call', label: 'Phone call' }]} />
        <TextField label="Phone" required type="tel" value={v.phone} onChange={set('phone')} error={errors.phone} placeholder="+91 98407 22110" />
        <TextField label="Alternate phone" type="tel" value={v.altPhone} onChange={set('altPhone')} error={errors.altPhone} />
        <TextField label="Email" type="email" value={v.email} onChange={set('email')} error={errors.email} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Profile</div>
        <div className="form-grid">
        <TextField label="Occupation" value={v.occupation} onChange={set('occupation')} error={errors.occupation} maxLength={80} />
        <TextArea className="span-2" label="Address" rows={2} value={v.address} onChange={set('address')} error={errors.address} maxLength={300} />
        </div>
      </div>
    </Modal>
  );
}

