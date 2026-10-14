import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Banner, Button, Card, DataTable, Empty, ErrorState, Flow, Grid, InlineError, Kpi, Meter, Modal, Page, PageHead, PageSkeleton,
  SelectField, StatStrip, Status, TextArea, TextField, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { PayslipModal, TotalsBar, monthLabel } from './shared';
import type { PayrollRun, PayslipRow, RunDetail } from './types';

export default function PayrollPage() {
  const { can } = useAuth();
  const { campusParam, campus, scope } = useSchool();
  const [sp, setSp] = useSearchParams();
  const runs = usePagedQuery<PayrollRun>('/payroll/runs', { ...campusParam, pageSize: 24 });
  const fromUrl = sp.get('run');
  const runId = (fromUrl && runs.data?.rows.some((x) => x.id === fromUrl) ? fromUrl : runs.data?.rows[0]?.id) ?? null;
  const detail = useApiQuery<RunDetail>(runId ? `/payroll/runs/${runId}` : null);
  const sampleNamed = usePagedQuery<PayslipRow>('/payslips', { runId: runId ?? undefined, pageSize: 1, q: 'Priya Raghavan' }, { enabled: !!runId });
  const sampleFirst = usePagedQuery<PayslipRow>('/payslips', { runId: runId ?? undefined, pageSize: 1, sort: 'name' }, { enabled: !!runId });
  const sampleSlip = sampleNamed.data?.rows[0] ?? sampleFirst.data?.rows[0];
  const [modal, setModal] = useState<'approve' | 'return' | 'new' | 'history' | null>(null);
  const [slipId, setSlipId] = useState<string | null>(null);
  const confirm = useConfirm();
  const selectRun = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('run', id); return n; }, { replace: true });

  const inputs = useStage(runId, 'inputs', 'Inputs collected');
  const calculate = useStage(runId, 'calculate', 'Payroll calculated — payslips generated');
  const submit = useStage(runId, 'submit', 'Submitted for approval');
  const release = useStage(runId, 'release', 'Payslips released to the staff app');
  const pay = useStage(runId, 'pay', 'Payroll marked as paid');

  const d = detail.data;
  const r = d?.run;
  const a = d?.actions;
  const busy = inputs.isPending || calculate.isPending || submit.isPending || release.isPending || pay.isPending;

  const flow = useMemo(() => {
    if (!d || !r) return [];
    const meta: Record<string, string | undefined> = {
      Draft: `Opened ${fmt.dateShort(r.createdAt)}`,
      Inputs: d.inputs ? `${d.inputs.pendingCount} pending` : undefined,
      Calculated: r.calculatedBy ? `${r.calculatedBy.split(' ')[0]} · ${fmt.dateShort(r.calculatedAt)}` : 'Not yet',
      'Under Review': r.submittedAt ? `Since ${fmt.dateShort(r.submittedAt)}` : undefined,
      Approved: r.approvedBy ? `${r.approvedBy} · ${fmt.dateShort(r.approvedAt)}` : d.stage === 3 ? 'Blocked until approved' : undefined,
      Released: r.releasedAt ? `${r.releasedSlips} payslips · ${fmt.dateShort(r.releasedAt)}` : 'Released to staff app',
      Paid: r.paidAt ? fmt.date(r.paidAt) : undefined,
    };
    return d.stages.map((s, i) => ({ label: s, meta: meta[s], state: (i < d.stage || (i === d.stage && s === 'Paid') ? 'done' : i === d.stage ? 'active' : undefined) as 'done' | 'active' | undefined }));
  }, [d, r]);

  let primary: React.ReactNode = null;
  if (r && a) {
    if (r.status === 'Draft' && a.canPrepare) primary = <Button variant="primary" icon="clipboard" loading={inputs.isPending} disabled={busy} onClick={() => inputs.mutate()}>Collect inputs</Button>;
    else if (r.status === 'Inputs' && a.canPrepare) {
      primary = <Button variant="primary" icon="zap" loading={calculate.isPending} disabled={busy} onClick={() => calculate.mutate()}>Calculate payroll</Button>;
    } else if (r.status === 'Calculated' && a.canSubmit) {
      primary = <>
        <Button icon="refresh" loading={calculate.isPending} disabled={busy} onClick={async () => {
          if (await confirm({ title: 'Recalculate payroll?', body: 'Payslips for this run are regenerated from the latest approved inputs.', confirmLabel: 'Recalculate' })) calculate.mutate();
        }}>Recalculate</Button>
        <Button variant="primary" icon="send" loading={submit.isPending} disabled={busy} onClick={() => submit.mutate()}>Submit for approval</Button>
      </>;
    } else if (r.status === 'Under Review' && a.canApprove) {
      primary = <Button variant="primary" icon="checkSquare" onClick={() => setModal('approve')}>
        {d?.inputs?.pendingCount ? `Approve payroll (${d.inputs.pendingCount} inputs pending)` : 'Approve payroll'}
      </Button>;
    } else if (r.status === 'Under Review' && a.makerChecker) {
      primary = <Button variant="primary" icon="lock" disabled title="The person who calculated this run cannot approve it">Awaiting another approver</Button>;
    } else if (r.status === 'Approved' && a.canRelease) {
      primary = <Button variant="primary" icon="send" loading={release.isPending} disabled={busy} onClick={async () => {
        if (await confirm({ title: `Release ${r.monthLabel} payslips?`, body: `${r.employeeCount} payslips become visible in the staff app and employees with accounts are notified.`, confirmLabel: 'Release payslips' })) release.mutate();
      }}>Release payslips</Button>;
    } else if (r.status === 'Released' && a.canPay) {
      primary = <Button variant="primary" icon="check" loading={pay.isPending} disabled={busy} onClick={async () => {
        if (await confirm({ title: 'Mark this run as paid?', body: `Net ${fmt.money(r.net)} has been transferred. Included overtime and reimbursements are settled. This cannot be undone.`, confirmLabel: 'Mark as paid', icon: 'check' })) pay.mutate();
      }}>Mark as paid</Button>;
    } else if (r.status === 'Approved' || r.status === 'Paid') {
      primary = <Button variant="teal" icon="check" disabled>{r.status === 'Paid' ? 'Payroll paid' : 'Payroll approved'}</Button>;
    }
  }

  const head = (
    <PageHead
      title="Payroll"
      sub={`${r ? `${r.monthLabel}${scope === 'group' && r.campusName ? ` · ${r.campusName}` : ''}` : 'Current'} run. Attendance, leave, overtime and allowances flow in automatically — approval is the only manual gate.`}
      actions={<>
        <Button icon="clock" onClick={() => setModal('history')}>Payroll history</Button>
        {can('payroll.manage') && <Button icon="plus" onClick={() => setModal('new')}>New run</Button>}
        {a?.canReturn && <Button onClick={() => setModal('return')}>Return for changes</Button>}
        {primary}
      </>}
    />
  );

  if (runs.isLoading) return <Page><PageSkeleton kpis={8} /></Page>;
  if (runs.error) return <Page>{head}<ErrorState error={runs.error} onRetry={() => runs.refetch()} /></Page>;
  if (!runs.data?.rows.length) {
    return (
      <Page>
        {head}
        <Card><Empty icon="wallet" title="No payroll runs yet" sub={campus ? `Open the first run for ${campus.shortName}.` : 'Choose a campus and open a run.'}
          action={can('payroll.manage') ? <Button variant="primary" icon="plus" onClick={() => setModal('new')}>New run</Button> : undefined} /></Card>
        {modal === 'new' && <NewRunModal onClose={() => setModal(null)} onCreated={selectRun} />}
      </Page>
    );
  }

  return (
    <Page>
      {head}
      {detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : !d || !r ? <PageSkeleton kpis={8} /> : (
        <>
          {r.status === 'Approved' && <div className="mb-4"><Banner tone="success" icon="check"><strong>{r.monthLabel.split(' ')[0]} payroll approved.</strong> Processing has started. Payslips will be released to the staff app once the run completes.</Banner></div>}
          {r.status === 'Inputs' && r.reviewNote && <div className="mb-4"><Banner tone="warning" icon="alert"><strong>Returned for changes:</strong> {r.reviewNote}</Banner></div>}
          {a?.makerChecker && <div className="mb-4"><Banner tone="neutral" icon="lock">You calculated this run, so another approver must review it (maker-checker).</Banner></div>}
          <Grid cols="g-4col">
            <Kpi size="hero" icon="wallet" label="Net payroll" value={fmt.money(r.net, { compact: true })} tone="teal"
              foot={`${r.monthLabel}${scope === 'group' && r.campusName ? ` · ${r.campusName}` : ''}`} />
            <Kpi size="hero" icon="trending" label="Gross salary" value={fmt.money(r.gross, { compact: true })}
              foot={`${fmt.money(r.deductions, { compact: true })} deductions`} />
            <Kpi size="hero" icon="users" label="Employees" value={fmt.n(r.employeeCount)} foot={<Status value={r.status} />} />
            <Kpi size="hero" icon="alertCircle" label="Pending approvals" value={d.inputs?.pendingCount ?? 0} tone={d.inputs?.pendingCount ? 'critical' : 'teal'}
              foot={d.inputs?.pendingCount ? 'Leave, overtime and claims awaiting a decision' : 'Nothing waiting'} />
          </Grid>
          <div className="statgrid statgrid--card fw-fit mt-3" aria-label="Run components">
            <Kpi size="compact" label="Payroll month" value={r.monthLabel.split(' ')[0].slice(0, 3)} unit={r.monthLabel.split(' ')[1]} />
            <Kpi size="compact" label="Deductions" value={fmt.money(r.deductions, { compact: true })} tone="critical" />
            <Kpi size="compact" label="Overtime" value={fmt.money(r.overtime, { compact: true })} tone="amber" to="/overtime" />
            <Kpi size="compact" label="Allowances" value={fmt.money(r.allowances, { compact: true })} tone="info" to="/staff-allowances" />
          </div>
          <div className="mt-5">
            <Card icon="receipt" title="Payroll workflow" sub="Attendance → Leave → Overtime → Allowances → Approval → Payroll processing → Payslip"
              actions={<Status value={r.status} lg />}>
              <Flow steps={flow} />
              {d.inputs && (
                <div className="mt-4">
                  <StatStrip items={[
                    { label: 'Attendance marks', value: `${fmt.n(d.inputs.attendance.marked)}${d.inputs.attendance.lastMarked ? ` · to ${fmt.dateShort(d.inputs.attendance.lastMarked)}` : ''}` },
                    { label: 'Leave applied', value: `${d.inputs.leave.approvedDays} days` },
                    { label: 'Overtime approved', value: `${d.inputs.overtime.hours} h · ${fmt.money(d.inputs.overtime.value, { compact: true })}` },
                    { label: 'Allowances', value: fmt.money(d.inputs.allowances.approved, { compact: true }) },
                    { label: 'Reimbursements', value: fmt.money(d.inputs.reimbursements.approved, { compact: true }) },
                  ]} />
                </div>
              )}
            </Card>
          </div>
          <div className="grid g-main mt-4">
            <Card icon="receipt" title="Payroll preview by category" flush
              foot={d.byCategory.length ? <TotalsBar items={[
                { label: 'Employees', value: fmt.n(d.byCategory.reduce((acc, c) => acc + c.count, 0)) },
                { label: 'Gross', value: fmt.money(r.gross, { compact: true }) },
                { label: 'Deductions', value: fmt.money(-r.deductions, { compact: true }), tone: 'critical' },
                { label: 'Net', value: fmt.money(r.net, { compact: true }) },
              ]} /> : undefined}>
              {d.byCategory.length ? (
                <DataTable rows={d.byCategory} rowKey={(c) => c.label}
                  columns={[
                    { key: 'label', label: 'Category' },
                    { key: 'count', label: 'Employees', className: 'num' },
                    { key: 'gross', label: 'Gross', className: 'num', render: (c) => <span className="t-num">{fmt.money(c.gross, { compact: true })}</span> },
                    { key: 'share', label: 'Share of payroll', sortable: false, render: (c) => (
                      <Meter label="" value={r.gross ? (c.gross / r.gross) * 100 : 0} right={fmt.pct(r.gross ? (c.gross / r.gross) * 100 : 0)} tone="info" />
                    ) },
                  ]} />
              ) : <Empty icon="zap" title="Not calculated yet" sub="Collect inputs and calculate to preview the run." />}
            </Card>
            <div className="col g-4">
              <Card icon="grid" title="Recent runs" flush>
                <DataTable compact rows={runs.data.rows.slice(0, 6)} rowKey={(x) => x.id} onRowClick={(x) => selectRun(x.id)}
                  rowClassName={(x) => (x.id === r.id ? 'is-selected' : undefined)}
                  columns={[
                    { key: 'month', label: 'Month', render: (x) => <>{x.monthLabel}{scope === 'group' && <div className="t-micro t-muted">{x.campusName}</div>}</> },
                    { key: 'net', label: 'Net', className: 'num', render: (x) => fmt.money(x.net, { compact: true }) },
                    { key: 'status', label: 'Status', render: (x) => <Status value={x.status} /> },
                  ]} />
              </Card>
              <Card icon="receipt" title="Sample payslip" sub={sampleSlip?.employeeName ?? 'No payslips in this run yet'}>
                <div className="row g-3">
                  <Button block icon="receipt" disabled={!sampleSlip} onClick={() => sampleSlip && setSlipId(sampleSlip.id)}>Open payslip</Button>
                </div>
                <p className="t-xs t-muted mt-3">Payslips are released to the staff app and printable from the payslip view. Non-teaching staff receive them the same way.</p>
              </Card>
            </div>
          </div>
        </>
      )}
      {modal === 'approve' && d && <ApproveModal detail={d} onClose={() => setModal(null)} />}
      {modal === 'return' && r && <ReturnModal run={r} onClose={() => setModal(null)} />}
      {modal === 'new' && <NewRunModal onClose={() => setModal(null)} onCreated={selectRun} />}
      {modal === 'history' && <HistoryModal runs={runs.data.rows} current={runId} onPick={(id) => { selectRun(id); setModal(null); }} onClose={() => setModal(null)} />}
      {slipId && <PayslipModal id={slipId} onClose={() => setSlipId(null)} />}
    </Page>
  );
}

/** One workflow transition of the selected run. */
function useStage(runId: string | null, action: string, success: string) {
  return useApiMutation<void>('post', `/payroll/runs/${runId}/${action}`, { invalidate: ['/payroll', '/payslips', '/workforce'], success, body: () => ({}) });
}

function ApproveModal({ detail, onClose }: { detail: RunDetail; onClose: () => void }) {
  const r = detail.run;
  const approve = useApiMutation<void>('post', `/payroll/runs/${r.id}/approve`, {
    invalidate: ['/payroll', '/payslips'], success: 'Payroll approved — processing started', body: () => ({}), onSuccess: onClose,
  });
  const items = detail.inputs?.pendingItems ?? [];
  return (
    <Modal open onClose={onClose} busy={approve.isPending} title="Approve payroll" sub={`${r.monthLabel} · ${r.campusName ?? ''} · ${r.employeeCount} employees · net ${fmt.money(r.net)}`}
      foot={<>
        <Button onClick={onClose} disabled={approve.isPending}>Cancel</Button>
        <Button variant="primary" icon="check" loading={approve.isPending} onClick={() => approve.mutate()}>Approve {fmt.money(r.net, { compact: true })}</Button>
      </>}>
      <DataTable compact stack={false} rows={[
        { what: 'Gross salary', count: r.employeeCount, value: r.gross },
        { what: 'Approved overtime', count: detail.inputs?.overtime.items ?? 0, value: r.overtime },
        { what: 'Allowances', count: r.employeeCount, value: r.allowances },
        { what: 'Deductions', count: r.employeeCount, value: -r.deductions },
      ]} rowKey={(x) => x.what}
        columns={[
          { key: 'what', label: 'Included in this run' },
          { key: 'count', label: 'Items', className: 'num' },
          { key: 'value', label: 'Value', className: 'num', render: (x) => fmt.money(x.value) },
        ]} />
      <div className="fw-grandtotal">
        <span className="fw-grandtotal__label">Net payroll to approve</span>
        <span className="fw-grandtotal__value">{fmt.money(r.net)}</span>
      </div>
      {items.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-2">Still awaiting a decision — not included</div>
          <DataTable compact stack={false} rows={items} rowKey={(x) => x.what}
            columns={[
              { key: 'what', label: 'Input' },
              { key: 'count', label: 'Items', className: 'num' },
              { key: 'value', label: 'Value', className: 'num', render: (x) => (x.value ? fmt.money(x.value) : '—') },
            ]} />
        </div>
      )}
      <div className="mt-4"><Banner tone="neutral" icon="info">Approving releases the run for processing. Payslips are only visible to staff after they are released. Calculated by {r.calculatedBy ?? '—'}.</Banner></div>
      {approve.error && <div className="mt-3"><InlineError error={approve.error} /></div>}
    </Modal>
  );
}

function ReturnModal({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const m = useApiMutation<void>('post', `/payroll/runs/${run.id}/return`, {
    invalidate: ['/payroll', '/payslips'], success: 'Returned to the preparer', body: () => ({ note: note.trim() }), onSuccess: onClose,
  });
  const error = note.trim().length < 3 ? 'Explain what needs to change' : undefined;
  return (
    <Modal open onClose={onClose} busy={m.isPending} title="Return for changes?" sub={`${run.monthLabel} · ${run.campusName ?? ''}`}
      foot={<>
        <Button onClick={onClose} disabled={m.isPending}>Cancel</Button>
        <Button variant="danger" icon="arrowLeft" loading={m.isPending} onClick={() => { setTouched(true); if (!error) m.mutate(); }}>Return run</Button>
      </>}>
      <p className="t-sm mb-3">The run goes back to Inputs. It must be recalculated and submitted again before approval.</p>
      <TextArea label="What needs to change" required rows={3} value={note} onChange={setNote} error={touched ? error : undefined} maxLength={500} />
      {m.error && <div className="mt-3"><InlineError error={m.error} /></div>}
    </Modal>
  );
}

function NewRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { lookups } = useLookups();
  const { campusId } = useSchool();
  const [f, setF] = useState({ campusId: campusId ?? '', payMonth: todayKey().slice(0, 7) });
  const [touched, setTouched] = useState(false);
  const m = useApiMutation<void, RunDetail>('post', '/payroll/runs', {
    invalidate: ['/payroll'], success: 'Payroll run opened', body: () => f,
    onSuccess: (res) => { onCreated(res.data.run.id); onClose(); },
  });
  const errors: Record<string, string> = {};
  if (!f.campusId) errors.campusId = 'Choose a campus';
  if (!/^\d{4}-\d{2}$/.test(f.payMonth)) errors.payMonth = 'Choose a month';
  return (
    <Modal open onClose={onClose} busy={m.isPending} title="New payroll run" sub="Opens a Draft run; inputs are collected next"
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) m.mutate(); }}>Open run</Button>
      </>}>
      <div className="grid g-2col g-3">
        <SelectField label="Campus" required value={f.campusId} onChange={(v) => setF((x) => ({ ...x, campusId: v }))} placeholder="Choose campus"
          error={touched ? errors.campusId : undefined} options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <TextField label="Pay month" type="month" required value={f.payMonth} onChange={(v) => setF((x) => ({ ...x, payMonth: v }))} error={touched ? errors.payMonth : undefined} />
      </div>
      {m.error && <div className="mt-3"><InlineError error={m.error} /></div>}
    </Modal>
  );
}

function HistoryModal({ runs, current, onPick, onClose }: { runs: PayrollRun[]; current: string | null; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="wide" title="Payroll history" sub="Choose a run to view" foot={<Button onClick={onClose}>Close</Button>}>
      <DataTable rows={runs} rowKey={(x) => x.id} onRowClick={(x) => onPick(x.id)} rowClassName={(x) => (x.id === current ? 'is-selected' : undefined)}
        columns={[
          { key: 'month', label: 'Month', render: (x) => monthLabel(x.payMonth) },
          { key: 'campus', label: 'Campus', render: (x) => x.campusName ?? 'Group' },
          { key: 'employees', label: 'Employees', className: 'num', render: (x) => x.employeeCount },
          { key: 'net', label: 'Net', className: 'num', render: (x) => <span className="t-num">{fmt.money(x.net)}</span> },
          { key: 'status', label: 'Status', render: (x) => <Status value={x.status} /> },
          { key: 'released', label: 'Released', render: (x) => fmt.date(x.releasedAt) },
        ]} />
    </Modal>
  );
}
