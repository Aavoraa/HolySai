import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import {
  Badge, Banner, Button, Checkbox, Dl, Empty, ErrorState, Icon, InlineError, Modal, SearchInput, SelectField, Skeleton,
  Status, TextArea, TextField,
} from '@/components/ui';
import type { AccountRow, Account, FinanceLookups, Receipt } from './types';

/** Finance lookups (fee heads, vendors, categories, employees), cached for 10 minutes. */
export function useFinanceLookups() {
  return useApiQuery<FinanceLookups>('/finance/lookups', undefined, { staleTime: 10 * 60_000 });
}

export function Money({ v, compact, strong, tone }: { v: number | null | undefined; compact?: boolean; strong?: boolean; tone?: string }) {
  return <span className={`t-num${strong ? ' t-bold' : ''}${tone ? ` t-${tone}` : ''}`}>{fmt.money(v, { compact })}</span>;
}

/** Server-side validation errors keyed by field. */
export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fieldErrors : {};
}

export const isMoney = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) > 0;
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export const METHOD_COLORS: Record<string, string> = {
  UPI: 'var(--teal)', 'Net Banking': 'var(--navy)', Card: 'var(--amber)', 'Cash / DD': 'var(--viz-8)',
};

/** Client-side CSV download (UTF-8 with BOM so Excel shows ₹ and dashes correctly). */
export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Reason prompt (reject / flag / resolve)
// ---------------------------------------------------------------------------
export function ReasonModal({ open, title, sub, label = 'Reason', confirmLabel = 'Confirm', danger, busy, onClose, onSubmit }: {
  open: boolean; title: string; sub?: ReactNode; label?: string; confirmLabel?: string; danger?: boolean; busy?: boolean;
  onClose: () => void; onSubmit: (reason: string) => void;
}) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setText(''); setTouched(false); } }, [open]);
  const error = touched && text.trim().length < 3 ? 'Please give a reason (at least 3 characters).' : undefined;
  return (
    <Modal open={open} onClose={onClose} title={title} sub={sub} busy={busy}
      foot={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy}
          onClick={() => { setTouched(true); if (text.trim().length >= 3) onSubmit(text.trim()); }}>{confirmLabel}</Button>
      </>}>
      <TextArea label={label} required value={text} onChange={setText} rows={3} maxLength={500} error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Receipt view / print / send on WhatsApp
// ---------------------------------------------------------------------------
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .fin-receipt, .fin-receipt * { visibility: visible !important; }
  .fin-receipt { position: fixed; left: 0; top: 0; width: 100%; }
}`;

export function ReceiptModal({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const q = useApiQuery<Receipt>(paymentId ? `/finance/payments/${paymentId}/receipt` : null);
  const send = useApiMutation<string>('post', (id) => `/finance/payments/${id}/send-receipt`, {
    invalidate: ['/finance/payments', '/finance/accounts'], body: () => ({}),
  });
  const r = q.data;
  return (
    <Modal open={!!paymentId} onClose={onClose} title={r ? `Receipt ${r.receiptNo}` : 'Receipt'} sub="Issued automatically on payment"
      foot={r && <>
        {can('finance.manage') && r.status === 'Success' && (
          <Button icon="message" loading={send.isPending} onClick={() => send.mutate(r.id)}>
            {r.receiptSentAt ? 'Send again on WhatsApp' : 'Send on WhatsApp'}
          </Button>
        )}
        <Button variant="primary" icon="printer" onClick={() => window.print()}>Print</Button>
      </>}>
      <style>{PRINT_CSS}</style>
      {q.isLoading && <Skeleton height={320} />}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {r && <ReceiptBody r={r} />}
      {r && (
        <div className="mt-3">
          {r.receiptSentAt
            ? <Banner tone="success" icon="message">A copy was queued to the parent on WhatsApp on {fmt.dateTime(r.receiptSentAt)}.</Banner>
            : <Banner tone="warning" icon="message">This receipt has not been sent to the parent yet.</Banner>}
        </div>
      )}
    </Modal>
  );
}

export function ReceiptBody({ r }: { r: Receipt }) {
  return (
    <div className="card card--tint fin-receipt">
      <div className="row between">
        <div>
          <div className="serif fin-receipt__school">Holy Sai International</div>
          <div className="t-micro t-muted">{r.student.campusShort} · Academic Year {r.academicYear}</div>
        </div>
        <Badge tone={r.status === 'Success' ? 'success' : 'critical'} icon={r.status === 'Success' ? 'check' : 'alert'} lg>
          {r.status === 'Success' ? 'Paid' : r.status}
        </Badge>
      </div>
      <div className="divider" />
      <Dl items={[
        ['Receipt number', r.receiptNo],
        ['Student', `${r.student.fullName} · ${r.student.admissionNo}`],
        ['Grade', r.student.grade ? `${r.student.grade}${r.student.section ?? ''}` : '—'],
        ['Paid on', fmt.dateTime(r.paidAt)],
        ['Method', r.method],
        ['Reference', r.gatewayRef ?? '—'],
        [r.paidBy ? 'Paid by' : 'Collected by', r.paidBy ?? r.collectedBy ?? '—'],
      ]} />
      <div className="divider" />
      {r.lines.length ? r.lines.map((l) => (
        <div className="row between mt-2" key={l.feeId}>
          <span className="t-sm">{l.description}{l.balanceAfter > 0 ? ' (part)' : ''}</span>
          <Money v={l.amount} />
        </div>
      )) : <p className="t-sm t-muted">No charges were settled by this transaction.</p>}
      <div className="divider" />
      <div className="row between">
        <span className="t-bold">Total paid</span>
        <span className="t-bold t-num fin-receipt__total">{fmt.money(r.amount)}</span>
      </div>
      {r.gatewayRef?.startsWith('SIM-') && <p className="t-micro t-muted mt-2">Online payment processed through the simulated gateway (development).</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student search (finance accounts)
// ---------------------------------------------------------------------------
export function StudentPicker({ onPick, campusId, placeholder = 'Search student name or admission ID' }: {
  onPick: (s: AccountRow) => void; campusId?: string; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const res = useApiQuery<AccountRow[]>(q.length >= 2 ? '/finance/accounts' : null, { q, pageSize: 8, campusId });
  return (
    <div className="col g-2">
      <SearchInput value={q} onSearch={setQ} placeholder={placeholder} maxWidth={9999} />
      {q.length >= 2 && (
        <div className="card fw-picker" aria-label="Matching students" aria-live="polite">
          {res.isLoading && <div className="fw-picker__msg"><Skeleton height={14} /></div>}
          {res.error ? <InlineError error={res.error} /> : null}
          {res.data && !res.data.length && <div className="t-sm t-muted fw-picker__msg">No students match “{q}”. Try the admission ID or part of the name.</div>}
          {res.data?.map((s) => (
            <button type="button" key={s.id} className="alert-item" onClick={() => { onPick(s); setQ(''); }}>
              <span className="grow">
                <span className="alert-item__title">{s.fullName}</span>
                <span className="alert-item__meta">{s.admissionNo} · {s.grade}{s.section} · {s.campus}</span>
              </span>
              <span className="row g-2 none"><Money v={s.balance} strong /><Status value={s.feeStatus} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counter payment
// ---------------------------------------------------------------------------
const COUNTER_METHODS = ['Cash', 'UPI', 'Card', 'Net Banking', 'DD', 'Cheque'];

export function PaymentModal({ account, open, onClose, onPaid }: {
  account: Account | undefined; open: boolean; onClose: () => void; onPaid: (paymentId: string) => void;
}) {
  const open_ = useMemo(() => (account?.lines ?? []).filter((l) => l.balance > 0), [account]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSel(new Set());
    setAmount(account ? String(account.summary.outstanding) : '');
    setMethod('Cash'); setReference(''); setTouched(false);
  }, [open, account]);
  const selectedTotal = open_.filter((l) => sel.has(l.id)).reduce((a, l) => a + l.balance, 0);
  const cap = sel.size ? selectedTotal : account?.summary.outstanding ?? 0;
  const pay = useApiMutation<Record<string, unknown>, { id: string; receiptNo: string }>('post', `/finance/accounts/${account?.student.id}/payments`, {
    invalidate: ['/finance'], onSuccess: (r) => onPaid(r.data.id),
  });
  const needsRef = ['DD', 'Cheque', 'UPI', 'Card', 'Net Banking'].includes(method);
  const errs: Record<string, string> = { ...fieldErrors(pay.error) };
  if (touched) {
    if (!isMoney(amount)) errs.amount = 'Enter an amount greater than zero (up to 2 decimals).';
    else if (Number(amount) > cap) errs.amount = `Cannot exceed the ${sel.size ? 'selected' : 'outstanding'} balance of ${fmt.money(cap)}.`;
    if (needsRef && !reference.trim()) errs.reference = 'Enter the transaction, DD or cheque reference.';
  }
  const submit = () => {
    setTouched(true);
    if (!isMoney(amount) || Number(amount) > cap || (needsRef && !reference.trim())) return;
    pay.mutate({ amount: Number(amount), method, reference: reference.trim() || undefined, feeIds: sel.size ? [...sel] : undefined });
  };
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSel(n);
    const tot = open_.filter((l) => n.has(l.id)).reduce((a, l) => a + l.balance, 0);
    setAmount(String(n.size ? tot : account?.summary.outstanding ?? ''));
  };
  return (
    <Modal open={open} onClose={onClose} busy={pay.isPending} size="wide"
      title="Take payment" sub={account ? `${account.student.fullName} · ${account.student.admissionNo} · outstanding ${fmt.money(account.summary.outstanding)}` : ''}
      foot={<>
        <Button onClick={onClose} disabled={pay.isPending}>Cancel</Button>
        <Button variant="teal" icon="creditCard" loading={pay.isPending} onClick={submit}>Record {isMoney(amount) ? fmt.money(Number(amount)) : 'payment'}</Button>
      </>}>
      {!open_.length ? <Empty icon="check" title="Nothing outstanding" sub="Every charge on this account is settled." /> : (
        <div>
          <div className="formsection">
            <div className="formsection__title">Apply to</div>
            <div className="formsection__sub">Optional — if nothing is selected, the oldest dues are settled first.</div>
            <div className="fw-applylines">
              {open_.map((l) => (
                <div key={l.id}>
                  <Checkbox checked={sel.has(l.id)} onChange={() => toggle(l.id)}
                    label={<span>{l.description} <span className="t-micro t-muted">due {fmt.date(l.dueDate)}</span></span>} />
                  <span className="row g-2"><Money v={l.balance} strong /><Status value={l.status} /></span>
                </div>
              ))}
            </div>
            <div className="fw-grandtotal">
              <span className="fw-grandtotal__label">{sel.size ? `Selected (${sel.size})` : 'Outstanding'}</span>
              <span className="fw-grandtotal__value">{fmt.money(cap)}</span>
            </div>
          </div>
          <div className="formsection">
            <div className="formsection__title">Payment</div>
            <div className="grid g-3col">
              <TextField label="Amount (₹)" required type="number" min="0" step="0.01" value={amount} onChange={setAmount} error={errs.amount}
                hint={`Up to ${fmt.money(cap)}`} />
              <SelectField label="Method" required value={method} onChange={setMethod} options={COUNTER_METHODS} error={errs.method} />
              <TextField label="Reference" required={needsRef} value={reference} onChange={setReference} maxLength={80} error={errs.reference}
                placeholder={method === 'Cash' ? 'Optional' : 'UTR / DD / cheque no.'} />
            </div>
          </div>
          <div className="mt-4"><Banner tone="neutral" icon="receipt">A numbered receipt is issued immediately and the parent is notified in the app and on WhatsApp.</Banner></div>
          {pay.error && !Object.keys(fieldErrors(pay.error)).length ? <div className="mt-3"><InlineError error={pay.error} /></div> : null}
        </div>
      )}
    </Modal>
  );
}

/** Totals row for a money table — sits in a Card `foot`, visually separated from the rows above. */
export function TotalsBar({ items, action }: { items: { label: string; value: ReactNode; tone?: 'critical' | 'success' }[]; action?: ReactNode }) {
  return (
    <div className="fw-totals">
      <dl className="fw-totals__items">
        {items.map((it) => (
          <div className="fw-totals__item" key={it.label}>
            <dt className="fw-totals__label">{it.label}</dt>
            <dd className={`fw-totals__value${it.tone ? ` t-${it.tone}` : ''}`}>{it.value}</dd>
          </div>
        ))}
      </dl>
      {action}
    </div>
  );
}

/** "N records" counter shown at the right of a table toolbar. */
export function ListCount({ total, noun }: { total: number | undefined; noun: string }) {
  if (total == null) return null;
  return <span className="fw-count" aria-live="polite"><strong>{fmt.n(total)}</strong> {noun}</span>;
}

export function SectionIcon({ name }: { name: string }) {
  return <span className="avatar none"><Icon name={name} size={17} /></span>;
}
