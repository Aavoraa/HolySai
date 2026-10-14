import { useState } from 'react';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery } from '@/hooks/useApi';
import { todayKey } from '@/lib/format';
import { Banner, Card, Empty, ErrorState, Icon, Page, PageHead, PageSkeleton, SectionHead, Spinner, TextField } from '@/components/ui';
import { useCsvDownload } from './shared';

interface Report { key: string; group: string; title: string; description: string; available: boolean; requires: string[]; alsoRequires: string[] }

const GROUPS = ['Students', 'Academics', 'Operations', 'Management'];
const DATED = new Set(['attendance-daily']);
const RANGED = new Set(['safety-log']);

export default function ReportsPage() {
  const { campusParam, campus, scope } = useSchool();
  const q = useApiQuery<Report[]>('/reports/catalog');
  const { download, busy } = useCsvDownload();
  const [date, setDate] = useState(todayKey());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeError = from && to && from > to ? 'The start date must be before the end date' : undefined;

  const head = <PageHead title="Reports" sub="Standard reports across every module, generated from live records as CSV files you can open in any spreadsheet." />;
  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={3} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;

  const run = (r: Report) => {
    if (!r.available || (RANGED.has(r.key) && rangeError)) return;
    const params: Record<string, string | undefined> = { ...campusParam };
    if (DATED.has(r.key)) params.date = date;
    if (RANGED.has(r.key)) { params.from = from || undefined; params.to = to || undefined; }
    download(r.key, `/reports/${r.key}/export`, params, `${r.key}.csv`);
  };

  return (
    <Page>
      {head}
      <div className="filterbar">
        <span className="t-sm t-muted"><strong className="t-strong">Campus:</strong> {scope === 'group' ? 'All campuses' : campus?.name ?? 'All campuses'}</span>
        <TextField label="Attendance date" type="date" max={todayKey()} value={date} onChange={(v) => setDate(v || todayKey())} />
        <TextField label="Safety log from" type="date" max={todayKey()} value={from} onChange={setFrom} />
        <TextField label="Safety log to" type="date" max={todayKey()} value={to} onChange={setTo} error={rangeError} />
        <div className="spacer" />
        <span className="t-xs t-muted">Every export is recorded in the audit trail.</span>
      </div>
      {!q.data.length && (
        <Card><Empty icon="fileText" title="No reports available" sub="Reports appear here once your role has access to at least one module. Ask an administrator if you expected to see some." /></Card>
      )}
      {GROUPS.map((g) => {
        const items = q.data!.filter((r) => r.group === g);
        if (!items.length) return null;
        return (
          <div className="mt-5" key={g}>
            <SectionHead title={g} />
            <div className="grid g-3col">
              {items.map((r) => (
                <button key={r.key} type="button" className="card card--link" disabled={!r.available || busy === r.key}
                  aria-disabled={!r.available} title={r.available ? `Download ${r.title}` : `Needs ${r.requires.join(' or ')}${r.alsoRequires.length ? ` and ${r.alsoRequires.join(', ')}` : ''}`}
                  style={{ padding: 18, textAlign: 'left', ...(r.available ? {} : { opacity: 0.55, cursor: 'not-allowed' }) }} onClick={() => run(r)}>
                  <span className="row g-3">
                    <span className="avatar none">{busy === r.key ? <Spinner /> : <Icon name={r.available ? 'fileText' : 'lock'} size={17} />}</span>
                    <span className="col grow">
                      <span className="t-sm t-bold">{r.title}</span>
                      <span className="t-micro t-muted">{r.description}</span>
                      <span className="t-micro t-faint mt-1">
                        {r.available ? `CSV${DATED.has(r.key) ? ` · ${date}` : ''}${RANGED.has(r.key) ? ` · ${from || 'last 90 days'} to ${to || 'today'}` : ''}` : 'Not available for your role'}
                      </span>
                    </span>
                    {r.available && <Icon name="download" size={15} className="t-faint" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="mt-5"><Banner tone="neutral" icon="clock">Scheduled email delivery of reports is not configured yet. Download a report whenever you need it — figures are always current.</Banner></div>
    </Page>
  );
}
