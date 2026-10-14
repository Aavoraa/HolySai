import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import {
  Badge, Banner, Button, Card, Chart, charts, DataTable, Empty, ErrorState, Grid, Kpi, Legend, Meter, Modal, Page, CampusBanner,
  PageSkeleton, SelectField, Status, StudentLink, TextArea, useConfirm, DashLayout, DashRail, SchoolPulse } from '@/components/ui';
import type { FeeDashboard, ReminderAudience } from './types';
import { METHOD_COLORS, Money, TotalsBar } from './shared';

const AGE_COLORS = ['var(--teal)', 'var(--viz-4)', 'var(--amber)', 'var(--critical)'];

export default function FeesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { campusParam } = useSchool();
  const q = useApiQuery<FeeDashboard>('/finance/fees/summary', campusParam);
  const [reminders, setReminders] = useState(false);
  const confirm = useConfirm();
  const remindOne = useApiMutation<{ studentIds: string[]; name: string }>('post', '/finance/fees/reminders', {
    body: (v) => ({ studentIds: v.studentIds, channel: 'whatsapp_app', message: 'Dear parent, the fee for {student} is overdue ({amount}). You can pay from the Holy Sai app, or contact the front office to discuss an instalment plan.' }),
    success: (_r, v) => `Reminder sent to the parent of ${v.name}`,
  });

  const head = (
    <CampusBanner
      title="Fee Collection"
      sub="Billing, collection, ageing and expected cash flow — with automated reminders behind every overdue figure."
      actions={can('finance.manage') && <>
        <Button icon="message" onClick={() => setReminders(true)}>Send reminders</Button>
        <Button variant="primary" icon="plus" onClick={() => navigate('/student-accounts')}>Record payment</Button>
      </>}
    />
  );
  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={4} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const k = d.kpis;
  const methodTotal = d.methods.reduce((a, m) => a + m.amount, 0);
  const upi = d.methods.find((m) => m.label === 'UPI');
  const headBilled = d.byHead.reduce((a, h) => a + h.billed, 0);
  const headCollected = d.byHead.reduce((a, h) => a + h.collected, 0);

  return (
    <Page>
      {head}
      <DashLayout rail={<DashRail events={false} actions={[
        { label: 'Payments', icon: 'creditCard', to: '/payments' },
        { label: 'Student Accounts', icon: 'users', to: '/student-accounts' },
        { label: 'Receipts', icon: 'receipt', to: '/receipts' },
        { label: 'Concessions', icon: 'percent', to: '/concessions' },
        { label: 'Expenses', icon: 'fileText', to: '/expenses' },
        { label: 'Financial Reports', icon: 'barChart', to: '/financial-reports' },
      ]} />}>
      <Grid cols="g-4col">
        <Kpi size="hero" icon="wallet" label="Collected" value={fmt.money(k.collected, { compact: true })} tone="teal" delta={k.collected30dDelta ?? undefined}
          foot={`${fmt.pct(k.collectionPct, 1)} of ${fmt.money(k.billed, { compact: true })} billed`} />
        <Kpi size="hero" icon="clock" label="Outstanding" value={fmt.money(k.outstanding, { compact: true })} tone="amber" foot={`${k.outstandingAccounts} student accounts`}
          onClick={() => navigate('/student-accounts?sort=balance&dir=desc')} />
        <Kpi size="hero" icon="alert" label="Overdue 30+ days" value={fmt.money(k.overdue, { compact: true })} tone="critical"
          foot={`${k.overdueAccounts} accounts · ${fmt.money(k.overdueAll, { compact: true })} past due in total`}
          onClick={() => navigate('/student-accounts?feeStatus=Overdue&sort=overdue&dir=desc')} />
        <Kpi size="hero" icon="calendar" label="Expected this month" value={fmt.money(k.expected, { compact: true })} tone="info" foot="Instalments falling due" />
      </Grid>
      <div className="statgrid statgrid--card fw-fit mt-3" aria-label="Billing figures">
        <Kpi size="compact" label="Total billed" value={fmt.money(k.billed, { compact: true })} foot="Academic year to date" />
        <Kpi size="compact" label="Collection rate" value={fmt.pct(k.collectionPct, 1)} tone="teal" foot="Collected ÷ billed" />
        <Kpi size="compact" label="Accounts outstanding" value={fmt.n(k.outstandingAccounts)} tone="amber" foot="With a balance due"
          onClick={() => navigate('/student-accounts?sort=balance&dir=desc')} />
        <Kpi size="compact" label="Accounts overdue 30+" value={fmt.n(k.overdueAccounts)} tone="critical" foot="Reminder candidates"
          onClick={() => navigate('/student-accounts?feeStatus=Overdue&sort=overdue&dir=desc')} />
      </div>
      <SchoolPulse />

      <div className="grid g-main mt-5">
        <Card icon="wallet" title="Collection trend" sub="Billed (invoices raised) against collected, by month">
          {d.trend.some((t) => t.billed || t.collected) ? <>
            <Chart svg={charts.bar({
              labels: d.trend.map((t) => t.label),
              series: [
                { name: 'Billed', values: d.trend.map((t) => t.billed), color: 'var(--border-strong)' },
                { name: 'Collected', values: d.trend.map((t) => t.collected), color: 'var(--teal)' },
              ],
              height: 250,
            })} />
            <div className="mt-3"><Legend items={[{ label: 'Billed', color: 'var(--border-strong)' }, { label: 'Collected', color: 'var(--teal)' }]} /></div>
          </> : <Empty icon="barChart" title="No billing yet" sub="Invoices and collections will appear here." />}
        </Card>
        <div className="col g-4">
          <Card icon="wallet" title="Overdue ageing" sub="Outstanding by days past the due date">
            {d.ageing.some((a) => a.value > 0) ? (
              <Chart svg={charts.hbar({
                rows: d.ageing.map((a, i) => ({ label: a.label, value: a.value, color: AGE_COLORS[i], display: fmt.money(a.value, { compact: true }) })),
                labelW: 92, rowH: 32,
              })} />
            ) : <Empty icon="check" title="Nothing overdue" sub="Every instalment is within its due date." />}
          </Card>
          <Card icon="wallet" title="Payment method">
            {methodTotal ? <>
              <Chart svg={charts.donut({
                size: 168, thickness: 24, center: `${upi?.pct ?? 0}%`, centerSub: 'by UPI',
                data: d.methods.map((m) => ({ label: m.label, value: m.pct, color: METHOD_COLORS[m.label] })),
              })} />
              <div className="mt-4"><Legend items={d.methods.map((m) => ({ label: `${m.label} ${m.pct}%`, color: METHOD_COLORS[m.label] }))} /></div>
            </> : <Empty icon="creditCard" title="No payments yet" sub="The method mix appears once the first payment is recorded." />}
          </Card>
        </div>
      </div>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="building" title="Campus comparison" sub="Collected and outstanding, all campuses">
          <Chart svg={charts.stacked({
            labels: d.byCampus.map((c) => c.label),
            series: [
              { name: 'Collected', values: d.byCampus.map((c) => c.collected), color: 'var(--teal)' },
              { name: 'Outstanding', values: d.byCampus.map((c) => c.outstanding), color: 'var(--amber)' },
            ],
            height: 230,
          })} />
          <div className="mt-3"><Legend items={[{ label: 'Collected', color: 'var(--teal)' }, { label: 'Outstanding', color: 'var(--amber)' }]} /></div>
        </Card>
        <Card icon="wallet" title="By fee head" sub="Billed against collected, this academic year" flush
          foot={d.byHead.length ? <TotalsBar items={[
            { label: 'Billed', value: fmt.money(headBilled, { compact: true }) },
            { label: 'Collected', value: fmt.money(headCollected, { compact: true }) },
            { label: 'Rate', value: headBilled ? fmt.pct((headCollected / headBilled) * 100, 1) : '—' },
          ]} /> : undefined}>
          <DataTable compact rows={d.byHead} rowKey={(r) => r.head} emptyText="No charges raised yet."
            columns={[
              { key: 'head', label: 'Head' },
              { key: 'billed', label: 'Billed', className: 'num', render: (r) => <Money v={r.billed} compact /> },
              { key: 'collected', label: 'Collected', className: 'num', render: (r) => <Money v={r.collected} compact /> },
              {
                key: 'pct', label: 'Rate', render: (r) => {
                  const p = r.billed ? Math.round((r.collected / r.billed) * 100) : 0;
                  return <Meter label="" value={p} right={`${p}%`} tone={p > 85 ? 'teal' : p > 60 ? 'amber' : 'critical'} />;
                },
              },
            ]} />
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="alert" title="Accounts needing attention" sub="Overdue beyond 30 days, ranked by amount" flush
          actions={<Button size="sm" iconRight="arrowRight" to="/student-accounts?feeStatus=Overdue&sort=overdue&dir=desc">Open student accounts</Button>}>
          <DataTable rows={d.attention} rowKey={(r) => r.id} emptyText="No account is more than 30 days overdue."
            onRowClick={(r) => navigate(`/student-accounts?student=${r.id}`)}
            columns={[
              { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={r.admissionNo} /> },
              { key: 'grade', label: 'Grade', render: (r) => `${r.grade ?? ''} ${r.section ?? ''}` },
              { key: 'due', label: 'Outstanding', className: 'num', render: (r) => <Money v={r.outstanding} strong /> },
              { key: 'age', label: 'Ageing', className: 'num', render: (r) => <Badge tone={r.ageDays > 90 ? 'critical' : 'warning'}>{r.ageDays} days</Badge> },
              { key: 'feeStatus', label: 'Status', render: (r) => <Status value={r.feeStatus} /> },
              {
                key: 'a', label: '', className: 'num', render: (r) => (
                  <div className="row g-2 end" onClick={(e) => e.stopPropagation()}>
                    {can('finance.manage') && (
                      <Button size="sm" icon="message" loading={remindOne.isPending && remindOne.variables?.studentIds[0] === r.id}
                        onClick={async () => {
                          if (await confirm({ title: 'Send a fee reminder?', body: `The parent of ${r.fullName} will receive an app and WhatsApp reminder for ${fmt.money(r.outstanding)}.`, confirmLabel: 'Send reminder', icon: 'send' })) {
                            remindOne.mutate({ studentIds: [r.id], name: r.fullName });
                          }
                        }}>Remind</Button>
                    )}
                    <Button size="sm" to={`/student-accounts?student=${r.id}`}>Ledger</Button>
                  </div>
                ),
              },
            ]} />
        </Card>
      </div>
      <RemindersModal open={reminders} onClose={() => setReminders(false)} />
      </DashLayout>
    </Page>
  );
}

const DEFAULT_MESSAGE = 'Dear parent, the fee instalment for {student} is outstanding ({amount}). You can pay from the Holy Sai app. Please contact the front office if you would like to discuss an instalment plan.';

function RemindersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { campusParam } = useSchool();
  const aud = useApiQuery<ReminderAudience>(open ? '/finance/fees/reminders/audience' : null, campusParam);
  const [audience, setAudience] = useState('overdue30');
  const [channel, setChannel] = useState('whatsapp_app');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setAudience('overdue30'); setChannel('whatsapp_app'); setMessage(DEFAULT_MESSAGE); setTouched(false); } }, [open]);
  const send = useApiMutation<Record<string, unknown>>('post', '/finance/fees/reminders', { onSuccess: onClose });
  const a = aud.data;
  const count = a ? (a as unknown as Record<string, number>)[audience] ?? 0 : 0;
  const msgErr = touched && message.trim().length < 10 ? 'Write a message of at least 10 characters.' : undefined;
  return (
    <Modal open={open} onClose={onClose} busy={send.isPending} title="Automated fee reminders"
      sub={a ? `${a.outstanding} accounts outstanding · ${a.overdue30} overdue 30+ days` : 'Loading audience…'}
      foot={<>
        <Button onClick={onClose} disabled={send.isPending}>Cancel</Button>
        <Button variant="primary" icon="send" loading={send.isPending} disabled={!count}
          onClick={() => { setTouched(true); if (message.trim().length >= 10) send.mutate({ audience, channel, message: message.trim(), ...campusParam }); }}>
          Send {count} reminder{count === 1 ? '' : 's'}
        </Button>
      </>}>
      <div className="col g-3">
        {aud.error ? <ErrorState error={aud.error} onRetry={() => aud.refetch()} /> : null}
        <SelectField label="Send to" value={audience} onChange={setAudience} options={[
          { value: 'overdue30', label: `Overdue 30+ days (${a?.overdue30 ?? '…'} accounts)` },
          { value: 'outstanding', label: `All outstanding (${a?.outstanding ?? '…'} accounts)` },
          { value: 'due7', label: `Due in the next 7 days (${a?.due7 ?? '…'} accounts)` },
        ]} />
        <SelectField label="Channel" value={channel} onChange={setChannel} options={[
          { value: 'whatsapp_app', label: 'WhatsApp + app' }, { value: 'whatsapp', label: 'WhatsApp only' }, { value: 'sms_app', label: 'SMS + app' },
        ]} />
        <TextArea label="Message" required rows={4} value={message} onChange={setMessage} maxLength={600} error={msgErr}
          hint="{student} is replaced with the child's first name and {amount} with the outstanding balance." />
        <Banner tone="neutral" icon="info">Reminders include a payment link. A receipt is issued automatically on payment and sent to the same channel.</Banner>
      </div>
    </Modal>
  );
}
