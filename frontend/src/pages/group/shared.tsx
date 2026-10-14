import { Card } from '@/components/ui';
import { fmt } from '@/lib/format';

export interface CampusMetrics {
  id: string; code: string; name: string; shortName: string; place: string; curriculum: string | null; address: string | null; established: number | null;
  students: number; atRisk: number; staff: number; staffTarget: number | null; staffingPct: number | null;
  admissionsYtd: number; enquiriesYtd: number; attendancePct: number | null; attendanceRecent: number | null; attendancePrevious: number | null;
  billed: number; collected: number; outstanding: number; collectionPct: number | null;
  engagement: number | null; nps: number | null; npsPrevious: number | null; npsMeasuredOn: string | null;
  academicIndex: number | null; academicPrevious: number | null; participationPct: number | null;
}

export interface MetricRow { key: string; label: string; format: 'n' | 'pct'; hint: string; values: Record<string, number | null>; group: number | null }

export const CAMPUS_COLORS = ['var(--navy)', 'var(--teal)', 'var(--amber)', 'var(--viz-4)', 'var(--viz-5)'];

export const fmtMetric = (v: number | null | undefined, format: 'n' | 'pct') =>
  v == null ? '—' : format === 'pct' ? fmt.pct(v, 1) : fmt.n(Math.round(v * 10) / 10);

/** Every measure, campus by campus. Best in each row is highlighted. */
export function ComparisonCard({ campuses, rows, loading }: { campuses: CampusMetrics[]; rows: MetricRow[]; loading?: boolean }) {
  return (
    <Card icon="building" title="Campus comparison" sub="Every measure, campus by campus, computed live. Best in each row is highlighted." flush>
      <div className="table-wrap">
        <table className="table" aria-busy={loading || undefined}>
          <thead>
            <tr>
              <th>Measure</th>
              {campuses.map((c) => <th key={c.id} className="num">{c.shortName}</th>)}
              <th className="num">Group</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const vals = campuses.map((c) => m.values[c.id]).filter((x): x is number => x != null);
              const best = vals.length > 1 ? Math.max(...vals) : null;
              return (
                <tr key={m.key}>
                  <td><span className="t-bold">{m.label}</span><div className="t-micro t-muted">{m.hint}</div></td>
                  {campuses.map((c) => {
                    const v = m.values[c.id];
                    return (
                      <td key={c.id} className="num">
                        <span className={`t-num ${v != null && v === best ? 't-bold t-success' : ''}`}>{fmtMetric(v, m.format)}</span>
                      </td>
                    );
                  })}
                  <td className="num t-bold">{fmtMetric(m.group, m.format)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function comparisonCsv(campuses: CampusMetrics[], rows: MetricRow[]) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Measure', ...campuses.map((c) => c.shortName), 'Group'].map(cell).join(',')];
  for (const r of rows) lines.push([r.label, ...campuses.map((c) => r.values[c.id]), r.group].map(cell).join(','));
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `campus-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
