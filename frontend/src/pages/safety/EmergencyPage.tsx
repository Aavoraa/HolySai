import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import {
  Badge, Banner, Button, Card, Checkbox, DataTable, ErrorState, Icon, Page, PageHead, Pagination, SelectField, Skeleton, Status, TextArea, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { FieldError, FormModal, incidentRowClass, SAFETY_KEYS, SeverityBadge, useFieldErrors } from './shared';
import type { Broadcast, Incident } from './types';

interface AudienceRow { key: string; label: string; count: number }

const TYPES = [
  { value: 'Emergency', label: 'Emergency' },
  { value: 'Drill', label: 'Drill (clearly labelled)' },
  { value: 'Urgent operational notice', label: 'Urgent operational notice' },
  { value: 'Lockdown', label: 'Lockdown' },
  { value: 'Evacuation', label: 'Evacuation' },
  { value: 'Weather', label: 'Weather' },
  { value: 'Transport', label: 'Transport' },
];
const CHANNELS = ['App + WhatsApp + SMS', 'App + WhatsApp', 'SMS only'];
const CRITICAL_TYPES = ['Emergency', 'Lockdown', 'Evacuation'];
const typeTone = (t: string) => (t === 'Drill' ? 'info' : CRITICAL_TYPES.includes(t) ? 'critical' : 'neutral');
/** Broadcast type: emergencies carry an alert icon, drills a shield; routine notices stay neutral. */
function TypeBadge({ type }: { type: string }) {
  return <Badge tone={typeTone(type)} icon={CRITICAL_TYPES.includes(type) ? 'alert' : type === 'Drill' ? 'shield' : undefined}>{type}</Badge>;
}

export default function EmergencyPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const canSend = can(['notifications.broadcast', 'safety.manage']);
  const audience = useApiQuery<AudienceRow[]>('/emergency/audience', campusParam);
  const [page, setPage] = useState(1);
  const history = usePagedQuery<Broadcast>('/emergency/broadcasts', { page, pageSize: 8, ...campusParam });
  const incidents = usePagedQuery<Incident>('/incidents', { pageSize: 8, sort: 'date', dir: 'desc', ...campusParam });
  const [compose, setCompose] = useState<string | null>(null);
  const total = (audience.data ?? []).reduce((a, x) => a + x.count, 0);

  return (
    <Page>
      <PageHead title="Emergency Alerts" sub="One action reaches every audience at once. Every broadcast is logged with who sent it and why." />
      <Card className="card--navy">
        <div className="row-top g-5 wrap">
          <div className="grow" style={{ minWidth: 0, flexBasis: 260 }}>
            <div className="eyebrow st-hero__eyebrow">Immediate broadcast</div>
            <h2 className="h1 mt-2 st-hero__title">Emergency broadcast</h2>
            <p className="t-sm mt-2 st-hero__text">
              Reaches parents, teachers, staff and management simultaneously across the app, WhatsApp and SMS. Use only for genuine emergencies. Every use is audited.
            </p>
            {canSend ? (
              <div className="row g-3 mt-4 wrap">
                <Button variant="danger" size="lg" icon="megaphone" onClick={() => setCompose('Emergency')}>Compose emergency broadcast</Button>
                <Button variant="onnavy" size="lg" icon="shield" onClick={() => setCompose('Drill')}>Run a drill instead</Button>
              </div>
            ) : (
              <p className="t-sm mt-4 st-hero__note"><Icon name="lock" size={13} /> You can view the history. Sending requires emergency broadcast rights.</p>
            )}
            {canSend && <p className="t-micro mt-3 st-hero__note">You review the message and confirm the audience before anything is sent.</p>}
          </div>
          <div className="none col g-2 st-hero__aside" aria-label="Who a broadcast reaches">
            {audience.error ? <span className="t-sm st-hero__note">Audience unavailable</span>
              : !audience.data ? [0, 1, 2, 3].map((i) => <Skeleton key={i} height={36} />)
              : (
                <>
                  {audience.data.map((a) => (
                    <div key={a.key} className="st-hero__aud">
                      <span className="st-hero__aud-label">{a.label}</span>
                      <span className="st-hero__aud-n">{fmt.n(a.count)} accounts</span>
                    </div>
                  ))}
                  <span className="st-hero__total">Up to <strong>{fmt.n(total)}</strong> people in total</span>
                </>
              )}
          </div>
        </div>
      </Card>

      <div className="col g-4 mt-4">
        <Card icon="activity" title="Broadcast history" sub="Who sent what, and how many people it reached — newest first" flush>
          {history.error ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : (
            <DataTable
              rows={history.data?.rows}
              loading={history.isLoading}
              rowKey={(r) => r.id}
              emptyText="No broadcasts have been sent."
              rowClassName={(r) => (CRITICAL_TYPES.includes(r.alertType) ? 'st-row--critical' : undefined)}
              columns={[
                { key: 'when', label: 'When', render: (r) => <span className="t-num">{fmt.dateTime(r.sentAt)}</span> },
                { key: 'type', label: 'Type', render: (r) => <TypeBadge type={r.alertType} /> },
                { key: 'what', label: 'Message', render: (r) => <><div className="t-sm">{r.message}</div><div className="t-micro t-muted">{[r.audience, r.campusName, r.sentByName && `sent by ${r.sentByName}`].filter(Boolean).join(' · ')}</div></> },
                { key: 'reach', label: 'Reach', className: 'num', render: (r) => <span className="t-num">{fmt.n(r.recipients)}</span> },
              ]}
            />
          )}
          <Pagination meta={history.data?.meta} onPage={setPage} />
        </Card>
        <Card icon="shield" title="Incident and audit trail" sub="Every safety event, open or closed" flush>
          {incidents.error ? <ErrorState error={incidents.error} onRetry={() => incidents.refetch()} /> : (
            <DataTable
              rows={incidents.data?.rows}
              loading={incidents.isLoading}
              rowKey={(r) => r.id}
              emptyText="No incidents recorded."
              rowClassName={incidentRowClass}
              columns={[
                { key: 'date', label: 'Date', render: (r) => fmt.date(r.occurredOn) },
                { key: 'summary', label: 'Incident', render: (r) => <><div className="t-sm">{r.summary}</div><div className="t-micro t-muted">{r.code} · {r.incidentType}</div></> },
                { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge value={r.severity} /> },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                { key: 'owner', label: 'Owner', render: (r) => r.ownerName ?? '—' },
              ]}
            />
          )}
        </Card>
      </div>

      {compose && <ComposeModal type={compose} total={total} audience={audience.data ?? []} onClose={() => setCompose(null)} />}
    </Page>
  );
}

function ComposeModal({ type, total, audience, onClose }: { type: string; total: number; audience: AudienceRow[]; onClose: () => void }) {
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const [f, setF] = useState({ alertType: type, message: '', channels: CHANNELS[0] });
  const [aud, setAud] = useState<Record<string, boolean>>({ parents: true, teachers: true, staff: true, management: true });
  const fe = useFieldErrors();
  const save = useApiMutation<Record<string, unknown>, { recipients: number }>('post', '/emergency/broadcasts', {
    invalidate: SAFETY_KEYS, onSuccess: onClose, success: (r) => `Broadcast sent to ${fmt.n(r.data.recipients)} recipients — logged in the audit trail`,
  });
  const chosen = Object.keys(aud).filter((k) => aud[k]);
  const reach = audience.filter((a) => aud[a.key]).reduce((a, x) => a + x.count, 0);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.message.trim().length < 10) e.message = 'Say what is happening and what people should do (at least 10 characters)';
    if (!chosen.length) e.audiences = 'Choose at least one audience';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const ok = await confirm({
      title: f.alertType === 'Drill' ? 'Send drill broadcast?' : `Send ${f.alertType.toLowerCase()} broadcast now?`,
      danger: f.alertType !== 'Drill', icon: 'megaphone', confirmLabel: 'Send broadcast now',
      body: (
        <div className="col g-3">
          <p className="t-sm">This reaches <strong>{fmt.n(reach)}</strong> people immediately by {f.channels}. It cannot be recalled.</p>
          <div className="st-preview">{f.alertType === 'Drill' ? 'DRILL — ' : ''}{f.message.trim()}</div>
        </div>
      ),
    });
    if (!ok) return;
    save.mutate({
      alertType: f.alertType, message: f.message.trim(), audiences: chosen, channels: f.channels, confirm: true,
      ...(campusParam.campusId ? { campusId: campusParam.campusId } : {}),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={f.alertType === 'Drill' ? 'Drill broadcast' : 'Emergency broadcast'} sub={`This reaches up to ${fmt.n(total)} people immediately`}
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit}
      submitLabel="Send broadcast now" submitIcon="megaphone" danger>
      {f.alertType === 'Drill'
        ? <Banner tone="neutral" icon="shield"><strong>Drill.</strong> Every message is clearly labelled DRILL. It still reaches everyone you select.</Banner>
        : <Banner tone="critical" icon="alert"><strong>Confirm before sending.</strong> Emergency broadcasts bypass quiet hours and per-user notification settings.</Banner>}
      <div className="formsection mt-4">
        <div className="formsection__title">Message</div>
        <div className="col g-3">
          <SelectField label="Type" required value={f.alertType} onChange={(v) => setF((x) => ({ ...x, alertType: v }))} options={TYPES} />
          <TextArea label="Message" required rows={3} maxLength={1000} value={f.message} placeholder="Say what is happening and what people should do."
            onChange={(v) => { setF((x) => ({ ...x, message: v })); fe.clear('message'); }} error={fe.errors.message}
            hint={f.alertType === 'Drill' ? 'Every message is prefixed with DRILL.' : `${f.message.trim().length}/1000 characters`} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Audience and channels</div>
        <div className="col g-3">
          <div className="field" role="group" aria-label="Send to">
            <span className="label">Send to <span className="req">*</span></span>
            <div className="row g-3 wrap">
              {audience.map((a) => (
                <Checkbox key={a.key} checked={!!aud[a.key]} onChange={(v) => { setAud((x) => ({ ...x, [a.key]: v })); fe.clear('audiences'); }}
                  label={`${a.label} (${fmt.n(a.count)})`} />
              ))}
            </div>
            <FieldError error={fe.errors.audiences} hint={<>Reaches <strong>{fmt.n(reach)}</strong> people</>} />
          </div>
          <SelectField label="Channels" required value={f.channels} onChange={(v) => setF((x) => ({ ...x, channels: v }))} options={CHANNELS} />
        </div>
      </div>
    </FormModal>
  );
}
