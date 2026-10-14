import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banner, Button, Card, Chips, DataTable, Dl, ErrorState, Flow, Meter, Modal, Page, PageHead, Pagination,
  SearchInput, SelectField, Skeleton, Status, TextArea, TextField, Toolbar, useConfirm, useToast,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import { AudiencePicker, ackTone, fieldErrorsOf } from './shared';
import type { AckSummary, Audience, Circular } from './types';

const CHANNEL_SETS: { label: string; value: string[] }[] = [
  { label: 'App + WhatsApp', value: ['push', 'whatsapp'] },
  { label: 'App only', value: ['push'] },
  { label: 'App + WhatsApp + SMS', value: ['push', 'sms', 'whatsapp'] },
  { label: 'App + WhatsApp + Email', value: ['email', 'push', 'whatsapp'] },
  { label: 'Email only', value: ['email'] },
];
const channelKey = (c: string[]) => [...c].sort().join(',');
const channelLabel = (c: string[]) => CHANNEL_SETS.find((s) => channelKey(s.value) === channelKey(c))?.label ?? c.join(' + ');

const STEPS = ['Draft', 'Under Review', 'Released'];
function flowFor(status: string) {
  const i = STEPS.indexOf(status);
  return STEPS.map((label, idx) => ({ label, state: (status === 'Withdrawn' ? 'done' : idx < i ? 'done' : idx === i ? 'active' : undefined) as 'done' | 'active' | undefined }));
}

/** Circular workflow actions shared by the list and the detail dialog. */
function useCircularActions() {
  const confirm = useConfirm();
  const inv = { invalidate: ['/circulars', '/communications'] };
  const submit = useApiMutation<string>('post', (id) => `/circulars/${id}/submit`, { ...inv, body: () => ({}) });
  const release = useApiMutation<string>('post', (id) => `/circulars/${id}/release`, { ...inv, body: () => ({}) });
  const giveBack = useApiMutation<string>('post', (id) => `/circulars/${id}/return`, { ...inv, body: () => ({}) });
  const withdraw = useApiMutation<string>('post', (id) => `/circulars/${id}/withdraw`, { ...inv, body: () => ({}) });
  const remind = useApiMutation<string>('post', (id) => `/circulars/${id}/remind`, { ...inv, body: () => ({}) });
  const busy = submit.isPending || release.isPending || giveBack.isPending || withdraw.isPending || remind.isPending;
  return {
    busy,
    submit: async (c: Circular) => {
      if (await confirm({ title: 'Send for approval?', body: `“${c.title}” will be locked for review by the Principal. You can still edit it until it is released.`, confirmLabel: 'Send for approval', icon: 'send' })) submit.mutate(c.id);
    },
    release: async (c: Circular) => {
      if (await confirm({
        title: 'Release this circular?',
        body: `“${c.title}” will be sent now to ${c.audience} (${fmt.n(c.targetCount)} ${c.audienceFilter.kind === 'staff' ? 'staff' : 'families'}) by ${channelLabel(c.channels)}. This cannot be undone — a released circular can only be withdrawn.`,
        confirmLabel: 'Release', icon: 'megaphone',
      })) release.mutate(c.id);
    },
    giveBack: async (c: Circular) => {
      if (await confirm({ title: 'Return for changes?', body: 'The circular goes back to Draft and its author is notified.', confirmLabel: 'Return to draft' })) giveBack.mutate(c.id);
    },
    withdraw: async (c: Circular) => {
      if (await confirm({ title: 'Withdraw this circular?', body: 'Families will no longer see it and no further reminders can be sent. Notifications already delivered cannot be recalled.', confirmLabel: 'Withdraw', danger: true })) withdraw.mutate(c.id);
    },
    remind: async (c: Circular) => {
      const pending = Math.max(0, c.targetCount - c.ackCount);
      if (await confirm({ title: `Remind ${fmt.n(pending)} families?`, body: `Families who have not acknowledged “${c.title}” get an app notification${c.channels.includes('whatsapp') ? ' and a WhatsApp message' : ''}.${c.lastRemindedAt ? ` The last reminder went out ${fmt.relative(c.lastRemindedAt)}.` : ''}`, confirmLabel: 'Send reminder', icon: 'send' })) remind.mutate(c.id);
    },
  };
}

export default function CircularsPage({ title = 'Circulars', sub = 'Broadcasts to parents, with acknowledgement tracked per family.' }: { title?: string; sub?: string }) {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'issued', dir: 'desc' }, ['status']);
  const [sp, setSp] = useSearchParams();
  const [form, setForm] = useState<{ open: boolean; circular?: Circular | null }>({ open: false });
  const openId = sp.get('circular');
  const setOpen = (id: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set('circular', id); else n.delete('circular'); return n; }, { replace: true });
  const summary = useApiQuery<AckSummary>('/circulars/summary', campusParam);
  const q = usePagedQuery<Circular>('/circulars', { ...list.query, ...campusParam });
  const act = useCircularActions();
  const canSend = can('communication.send');
  const canRelease = canSend && can('notifications.broadcast');

  return (
    <Page>
      <PageHead title={title} sub={sub}
        actions={canSend && <Button variant="primary" icon="plus" onClick={() => setForm({ open: true, circular: null })}>New circular</Button>} />
      {canRelease && (summary.data?.underReview ?? 0) > 0 && (
        <div className="mb-4">
          <Banner tone="warning" icon="clipboard">
            <strong>{summary.data!.underReview} circular{summary.data!.underReview > 1 ? 's' : ''} awaiting your approval.</strong>{' '}
            <Button size="sm" variant="quiet" onClick={() => list.setFilter('status', 'Under Review')}>Review now</Button>
          </Banner>
        </div>
      )}
      <Card flush>
        <Toolbar>
        <Chips
          items={[
            { id: '', label: 'All' }, { id: 'Draft', label: 'Draft', count: summary.data?.drafts },
            { id: 'Under Review', label: 'Under Review', count: summary.data?.underReview }, { id: 'Released', label: 'Released' }, { id: 'Withdrawn', label: 'Withdrawn' },
          ]}
          active={list.filters.status} onChange={(v) => list.setFilter('status', v)} />
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search circulars" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Circular>
            rows={q.data?.rows}
            loading={q.isLoading || q.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => setOpen(r.id)}
            emptyText={list.hasFilters ? 'No circulars match the current filters.' : canSend ? 'No circulars yet. Use “New circular” to draft one — it goes to the Principal for approval before release.' : 'No circulars yet.'}
            columns={[
              { key: 'title', label: 'Circular', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.audience}{r.campus ? ` · ${r.campus}` : ''}</div></> },
              { key: 'issued', label: 'Issued', render: (r) => r.publishedAt ? fmt.date(r.publishedAt) : <span className="t-muted">{r.status === 'Under Review' ? `Submitted ${fmt.dateShort(r.submittedAt)}` : 'Draft'}</span> },
              {
                key: 'ack', label: 'Acknowledged', width: '200px', render: (r) => {
                  if (r.status === 'Draft' || r.status === 'Under Review' || !r.targetCount) return <span className="t-faint">—</span>;
                  if (!r.requiresAck) return <span className="t-xs t-muted">Not required · {fmt.n(r.targetCount)} recipients</span>;
                  return <Meter label="" value={(r.ackCount / r.targetCount) * 100} right={`${fmt.n(r.ackCount)}/${fmt.n(r.targetCount)}`} tone={ackTone(r.ackCount, r.targetCount)} />;
                },
              },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => {
                  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
                  if (r.status === 'Draft' && canSend) return <Button size="sm" variant="primary" disabled={act.busy} onClick={stop(() => act.submit(r))}>Send for approval</Button>;
                  if (r.status === 'Under Review' && canRelease) return <Button size="sm" variant="primary" icon="megaphone" disabled={act.busy} onClick={stop(() => act.release(r))}>Release</Button>;
                  if (r.status === 'Released' && r.requiresAck && canSend && r.ackCount < r.targetCount) return <Button size="sm" disabled={act.busy} onClick={stop(() => act.remind(r))}>Remind unacknowledged</Button>;
                  return <Button size="sm" variant="quiet" onClick={stop(() => setOpen(r.id))}>View</Button>;
                },
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <CircularDetail id={openId} onClose={() => setOpen(null)} onEdit={(c) => setForm({ open: true, circular: c })} />
      <CircularForm open={form.open} circular={form.circular ?? null} onClose={() => setForm({ open: false })} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
function CircularDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (c: Circular) => void }) {
  const { can } = useAuth();
  const q = useApiQuery<Circular>(id ? `/circulars/${id}` : null);
  const act = useCircularActions();
  const c = q.data;
  const canSend = can('communication.send');
  const canRelease = canSend && can('notifications.broadcast');
  return (
    <Modal open={!!id} onClose={onClose} size="wide" title={c?.title ?? 'Circular'} sub={c ? `${c.audience}${c.campus ? ` · ${c.campus}` : ' · All campuses'}` : undefined}
      foot={c && <>
        {(c.status === 'Draft' || c.status === 'Under Review') && canSend && <Button icon="edit" onClick={() => { onClose(); onEdit(c); }}>Edit</Button>}
        {c.status === 'Released' && canRelease && <Button variant="danger" disabled={act.busy} onClick={() => act.withdraw(c)}>Withdraw</Button>}
        {c.status === 'Released' && c.requiresAck && <Button icon="checkSquare" to={`/acknowledgements?circular=${c.id}`}>Who acknowledged</Button>}
        {c.status === 'Released' && c.requiresAck && canSend && <Button icon="send" disabled={act.busy} onClick={() => act.remind(c)}>Remind unacknowledged</Button>}
        {c.status === 'Under Review' && canRelease && <Button disabled={act.busy} onClick={() => act.giveBack(c)}>Return for changes</Button>}
        {c.status === 'Under Review' && canRelease && <Button variant="primary" icon="megaphone" disabled={act.busy} onClick={() => act.release(c)}>Release</Button>}
        {c.status === 'Draft' && canSend && <Button variant="primary" icon="send" disabled={act.busy} onClick={() => act.submit(c)}>Send for approval</Button>}
      </>}>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !c ? <Skeleton height={240} /> : (
        <div className="col g-4">
          <Flow steps={flowFor(c.status)} />
          {c.status === 'Withdrawn' && <Banner tone="neutral">This circular was withdrawn and is no longer shown to families.</Banner>}
          {c.status === 'Under Review' && !canRelease && <Banner tone="neutral" icon="clock">Waiting for approval by the Principal.</Banner>}
          <div className="card card--tint pe-circular-body"><p className="t-sm">{c.body}</p></div>
          {c.status === 'Released' && c.requiresAck && (
            <Meter label="Acknowledged" value={c.targetCount ? (c.ackCount / c.targetCount) * 100 : 0} right={`${fmt.n(c.ackCount)} of ${fmt.n(c.targetCount)}`} tone={ackTone(c.ackCount, c.targetCount)} lg
              hint={c.lastRemindedAt ? `${c.reminderCount} reminder${c.reminderCount === 1 ? '' : 's'} sent · last ${fmt.relative(c.lastRemindedAt)}` : 'No reminders sent yet'} />
          )}
          <Dl items={[
            ['Audience', `${c.audience} · ${fmt.n(c.targetCount)} ${c.audienceFilter.kind === 'staff' ? 'staff accounts' : 'families'}`],
            ['Channels', channelLabel(c.channels)],
            ['Acknowledgement', c.requiresAck ? 'Required' : 'Not required'],
            ['Drafted by', `${c.createdBy ?? '—'} · ${fmt.dateTime(c.createdAt)}`],
            ['Submitted by', c.submittedBy ? `${c.submittedBy} · ${fmt.dateTime(c.submittedAt)}` : '—'],
            ['Released by', c.releasedBy ? `${c.releasedBy} · ${fmt.dateTime(c.publishedAt)}` : '—'],
          ]} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function CircularForm({ open, circular, onClose }: { open: boolean; circular: Circular | null; onClose: () => void }) {
  const { campusId: headerCampus } = useSchool();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>({ kind: 'all' });
  const [campusId, setCampusId] = useState('');
  const [channels, setChannels] = useState(CHANNEL_SETS[0].label);
  const [ack, setAck] = useState('Required');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTitle(circular?.title ?? '');
    setBody(circular?.body ?? '');
    setAudience(circular?.audienceFilter ?? { kind: 'all' });
    setCampusId(circular ? circular.campusId ?? '' : headerCampus ?? '');
    setChannels(circular ? channelLabel(circular.channels) : CHANNEL_SETS[0].label);
    setAck(circular && !circular.requiresAck ? 'Not required' : 'Required');
  }, [open, circular]); // eslint-disable-line react-hooks/exhaustive-deps

  const inv = { invalidate: ['/circulars'] };
  const create = useApiMutation<Record<string, unknown>, Circular>('post', '/circulars', { ...inv, success: false });
  const update = useApiMutation<Record<string, unknown>, Circular>('put', `/circulars/${circular?.id}`, { ...inv, success: false });
  const submit = useApiMutation<string>('post', (id) => `/circulars/${id}/submit`, { ...inv, body: () => ({}), success: 'Circular sent for approval' });
  const pending = create.isPending || update.isPending || submit.isPending;

  const save = async (andSubmit: boolean) => {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = 'Enter a title (at least 3 characters)';
    if (body.trim().length < 10) e.body = 'Write the message (at least 10 characters)';
    if (audience.kind === 'grades' && !audience.grades?.length) e['audience.grades'] = 'Choose at least one grade';
    setErrors(e);
    if (Object.keys(e).length) return;
    const payload = {
      title: title.trim(), body: body.trim(), audience, campusId: campusId || null,
      requiresAck: audience.kind !== 'staff' && ack === 'Required',
      channels: CHANNEL_SETS.find((s) => s.label === channels)?.value ?? ['push'],
    };
    try {
      const r = circular ? await update.mutateAsync(payload) : await create.mutateAsync(payload);
      if (andSubmit && r.data.status === 'Draft') await submit.mutateAsync(r.data.id);
      else toast(circular ? 'Circular updated' : 'Circular saved as draft', 'success');
      onClose();
    } catch (err) {
      setErrors(fieldErrorsOf(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={pending} size="wide" title={circular ? 'Edit circular' : 'New circular'}
      sub={circular?.status === 'Under Review' ? 'Under review — changes are visible to the approver' : undefined}
      foot={<>
        <Button onClick={onClose} disabled={pending}>Cancel</Button>
        <Button icon="save" onClick={() => save(false)} loading={create.isPending || update.isPending}>Save draft</Button>
        {circular?.status !== 'Under Review' && <Button variant="primary" icon="send" onClick={() => save(true)} loading={submit.isPending}>Send for approval</Button>}
      </>}>
      <div className="formsection">
        <div className="formsection__title">Message</div>
        <div className="col g-3">
        <TextField label="Title" required value={title} onChange={setTitle} error={errors.title} placeholder="For example: Term 3 examination schedule" maxLength={160} autoFocus />
        <TextArea label="Message" required rows={6} value={body} onChange={setBody} error={errors.body} maxLength={5000} hint={`${body.length}/5000`} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Audience</div>
        <AudiencePicker value={audience} onChange={setAudience} campusId={campusId} onCampus={setCampusId} error={errors['audience.grades'] ?? errors.audience} />
      </div>
      <div className="formsection">
        <div className="formsection__title">Delivery and approval</div>
        <div className="col g-3">
        <div className="form-grid">
          <SelectField label="Channels" value={channels} onChange={setChannels} options={CHANNEL_SETS.map((s) => s.label)} />
          <SelectField label="Acknowledgement" value={audience.kind === 'staff' ? 'Not required' : ack} onChange={setAck}
            options={['Required', 'Not required']} disabled={audience.kind === 'staff'}
            hint={audience.kind === 'staff' ? 'Staff circulars are informational' : undefined} />
        </div>
        <Flow steps={flowFor(circular?.status ?? 'Draft')} />
        </div>
      </div>
    </Modal>
  );
}
