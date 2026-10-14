import { useState } from 'react';
import { api } from '@/api/client';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { Button, DataTable, Empty, Icon, Modal, Page, PageHead, Spinner, useToast } from '@/components/ui';
import type { Report } from './types';
import { downloadCsv } from './shared';

const REPORTS: [key: string, title: string, sub: string, icon: string][] = [
  ['fee-collection', 'Fee collection summary', 'Billed, collected and outstanding by head and campus', 'wallet'],
  ['ageing', 'Ageing analysis', 'Outstanding by days overdue, by grade and by campus', 'clock'],
  ['cash-flow', 'Cash flow forecast', 'Expected receipts by instalment due date', 'trending'],
  ['concessions', 'Concession and scholarship report', 'Value awarded, by type and by approver', 'award'],
  ['expense-budget', 'Expense and budget report', 'Department spend against budget, with commitments', 'pieChart'],
  ['payroll-cost', 'Payroll cost report', 'Gross, deductions, net and cost per category', 'briefcase'],
  ['reconciliation', 'Reconciliation log', 'Matched, unmatched and exception history', 'check'],
  ['campus-comparison', 'Campus comparison', 'Every financial measure, campus by campus', 'building'],
  ['audit-pack', 'Audit pack', 'Everything an auditor asks for, in one export', 'folder'],
];

function cell(v: unknown, money?: boolean) {
  if (v == null || v === '') return '—';
  if (money) return fmt.money(Number(v));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmt.dateTime(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmt.date(v);
  return String(v);
}

export default function FinancialReportsPage() {
  const { campusParam } = useSchool();
  const toast = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const open = async (key: string) => {
    setLoading(key);
    try {
      setReport(await api.get<Report>(`/finance/reports/${key}`, campusParam));
    } catch (err) {
      toast((err as Error).message, 'critical');
    } finally {
      setLoading(null);
    }
  };
  const exportCsv = (r: Report) => {
    downloadCsv(`${r.key}-${r.generatedAt.slice(0, 10)}.csv`, r.columns, r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.key, c.money ? row[c.key] : cell(row[c.key])]))));
    toast(`${r.title} exported`, 'success', 'download');
  };

  return (
    <Page>
      <PageHead title="Financial Reports" sub="Standard reports, each generated from live data and exportable." />
      <div className="grid g-3col g-4">
        {REPORTS.map(([key, title, sub, icon]) => (
          <button key={key} type="button" className="card card--link fw-report-tile" onClick={() => open(key)} disabled={!!loading} aria-busy={loading === key || undefined}>
            <span className="row g-3">
              <span className="avatar none"><Icon name={icon} size={17} /></span>
              <span className="col grow"><span className="t-sm t-bold">{title}</span><span className="t-micro t-muted">{sub}</span></span>
            </span>
            <span className="row g-2 mt-3 t-xs t-muted">{loading === key ? <Spinner size={13} /> : <Icon name="eye" size={13} />}{loading === key ? 'Generating…' : 'View, print or export to Excel (CSV)'}</span>
          </button>
        ))}
      </div>
      <Modal open={!!report} onClose={() => setReport(null)} size="wide" title={report?.title ?? ''}
        sub={report ? `Generated ${fmt.dateTime(report.generatedAt)} · ${report.rows.length} rows` : ''}
        foot={report && <>
          <Button icon="printer" onClick={() => window.print()}>Print</Button>
          <Button variant="primary" icon="download" disabled={!report.rows.length} onClick={() => exportCsv(report)}>Download CSV</Button>
        </>}>
        {report && (report.rows.length ? (
          <div className="fw-report-scroll">
            <DataTable compact rows={report.rows} rowKey={(r) => JSON.stringify(r)}
              columns={report.columns.map((c) => ({ key: c.key, label: c.label, className: c.money ? 'num' : undefined, render: (r: Record<string, unknown>) => cell(r[c.key], c.money) }))} />
          </div>
        ) : <Empty icon="fileText" title="Nothing to report yet" sub="This report has no rows for the current selection." />)}
      </Modal>
    </Page>
  );
}
