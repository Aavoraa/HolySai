import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Banner, Button, Chips, Empty, ErrorState, Icon, Page, PageHead, PageSkeleton,
  SearchInput, SectionHead, StatStrip,
} from '@/components/ui';
import { GROUP_ICON, orderGroups } from './shared';
import type { ReportCatalogItem } from './types';

/**
 * Report Centre — the administrator's index of every standard report. Tiles open
 * the report on screen rather than downloading it blind; the platform reports in
 * the System group are returned by the API to Super Admin only.
 */
export default function ReportCenterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { campus, scope } = useSchool();
  const q = useApiQuery<ReportCatalogItem[]>('/reports/catalog');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');

  const all = useMemo(() => q.data ?? [], [q.data]);
  const groups = useMemo(() => orderGroups(all.map((r) => r.group)), [all]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter(
      (r) => (group === 'all' || r.group === group)
        && (!term || `${r.title} ${r.description} ${r.group}`.toLowerCase().includes(term)),
    );
  }, [all, group, search]);

  const head = (
    <PageHead
      title="Report Centre"
      sub="Every standard report, built from live records. Open one to review it on screen, then export the same figures as CSV."
    />
  );
  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={3} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;

  const available = all.filter((r) => r.available);
  const restricted = all.filter((r) => r.restricted);

  return (
    <Page>
      {head}

      <StatStrip
        items={[
          { label: 'Reports you can run', value: `${available.length} of ${all.length}` },
          { label: 'Groups', value: groups.length },
          { label: 'Platform reports', value: restricted.length || '—' },
          { label: 'Campus scope', value: scope === 'group' ? 'All campuses' : campus?.name ?? 'All campuses' },
        ]}
      />

      <div className="filterbar mt-4">
        <SearchInput value={search} onSearch={setSearch} placeholder="Search reports" />
        <Chips
          items={[{ id: 'all', label: 'All', count: all.length }, ...groups.map((g) => ({ id: g, label: g, count: all.filter((r) => r.group === g).length }))]}
          active={group}
          onChange={setGroup}
        />
        <div className="spacer" />
        <span className="t-xs t-muted">Every export is recorded in the audit trail.</span>
      </div>

      {!matches.length && (
        <div className="mt-4">
          <Empty
            icon="search"
            title="No report matches that search"
            sub="Try a different word, or clear the group filter."
            action={<Button size="sm" onClick={() => { setSearch(''); setGroup('all'); }}>Clear search and filters</Button>}
          />
        </div>
      )}

      {orderGroups(matches.map((r) => r.group)).map((g) => {
        const items = matches.filter((r) => r.group === g);
        return (
          <div className="mt-5" key={g}>
            <SectionHead
              title={<span className="row g-2"><Icon name={GROUP_ICON[g] ?? 'fileText'} size={16} />{g}</span>}
              sub={g === 'System' ? 'Platform and security reports — Super Admin only' : undefined}
              right={<span className="t-xs t-muted">{items.length} report{items.length === 1 ? '' : 's'}</span>}
            />
            <div className="grid g-3col">
              {items.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={r.available ? 'card card--link oi-report-tile' : 'card oi-report-tile oi-report-tile--locked'}
                  disabled={!r.available}
                  aria-disabled={!r.available}
                  title={r.available ? `Open ${r.title}` : `Needs ${r.requires.join(' or ')}`}
                  onClick={() => r.available && navigate(`/admin/reports/${r.key}`)}
                >
                  <span className="row g-3">
                    <span className="avatar none">
                      <Icon name={r.available ? (GROUP_ICON[r.group] ?? 'fileText') : 'lock'} size={17} />
                    </span>
                    <span className="col grow oi-minw0">
                      <span className="row g-2 wrap">
                        <span className="t-sm t-bold">{r.title}</span>
                        {r.restricted && <Badge tone="info" icon="shieldCheck">Platform</Badge>}
                      </span>
                      <span className="t-micro t-muted">{r.description}</span>
                      <span className="t-micro t-faint mt-1">
                        {r.available ? 'Preview on screen · export CSV' : 'Not available for your role'}
                      </span>
                    </span>
                    {r.available && <Icon name="chevronRight" size={15} className="t-faint" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {!restricted.length && user?.role.key !== 'super_admin' && (
        <div className="mt-5">
          <Banner tone="neutral" icon="shieldCheck">
            Platform reports — user access, sign-in activity, the role matrix and the audit trail — are reserved for Super Admin.
          </Banner>
        </div>
      )}
    </Page>
  );
}
