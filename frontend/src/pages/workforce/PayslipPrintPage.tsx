import { useParams, useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { Banner, Button, Card, Dl, ErrorState, Lotus, Page, PageSkeleton } from '@/components/ui';
import { fmt } from '@/lib/format';
import { PayslipDocument } from './shared';
import type { Payslip } from './types';

/** Printable payslip (payroll staff: /payslips/:id, employee: /staff-self/payslips/:id). */
export default function PayslipPrintPage({ self }: { self?: boolean }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const q = useApiQuery<Payslip>(valid ? (self ? `/me/payslips/${id}` : `/payslips/${id}`) : null);
  const s = q.data;

  return (
    <Page className="payslip-print">
      <div className="pagehead">
        <div className="grow">
          <h1 className="pagehead__title">Payslip{s ? ` — ${s.monthLabel}` : ''}</h1>
          {s && <p className="pagehead__sub">{s.employeeName} · {s.employeeCode} · {s.designation}</p>}
        </div>
        <div className="pagehead__actions">
          <Button icon="arrowLeft" onClick={() => navigate(-1)}>Back</Button>
          <Button variant="primary" icon="printer" disabled={!s} onClick={() => window.print()}>Print / save as PDF</Button>
        </div>
      </div>
      {!valid ? <ErrorState error={new Error('This payslip link is not valid.')} title="Payslip not found" /> : q.isLoading ? <PageSkeleton kpis={0} /> : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : s ? (
        <Card>
          <div className="payslip-head">
            <div className="row g-3">
              <Lotus size={40} />
              <div>
                <div className="serif payslip-head__school">{s.campusName ?? 'Holy Sai'}</div>
                <div className="t-xs t-muted">{s.campusAddress}</div>
              </div>
            </div>
            <div className="payslip-head__month">
              <div className="eyebrow">Payslip</div>
              <div className="t-bold">{s.monthLabel}</div>
            </div>
          </div>
          <div className="mb-5">
            <Dl items={[
              ['Employee', `${s.employeeName} (${s.employeeCode})`],
              ['Designation', `${s.designation} · ${s.department}`],
              ['Joined', fmt.date(s.joinDate)],
            ]} />
          </div>
          {s.status !== 'Released' && <div className="mb-4"><Banner tone="warning" icon="alert">Draft — this payslip has not been released and may change.</Banner></div>}
          <PayslipDocument slip={s} />
          <p className="t-micro t-muted mt-5">Computer-generated payslip; no signature required. Sample data for demonstration.</p>
        </Card>
      ) : null}
    </Page>
  );
}
