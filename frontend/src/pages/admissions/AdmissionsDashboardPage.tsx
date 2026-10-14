import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import {
  AlertItem, Button, Card, Chart, charts, Empty, ErrorState, Funnel, Grid, Icon, Kpi, Legend, Page, CampusBanner, PageSkeleton, Segment, DashLayout, DashRail, SchoolPulse } from '@/components/ui';
import { cx, fmt } from '@/lib/format';
import { LeadFormModal } from './LeadForms';
import { LeadProfileHost } from './LeadProfile';
import { LeadsTable, SOURCE_COLOR, useLeadParam } from './shared';
import type { Lead, Named } from './types';

interface Dashboard {
  kpis: {
    enquiries: number; qualified: number; qualifiedPct: number; visits: number; visitsThisWeek: number; applications: number;
    awaitingDocuments: number; offers: number; offersExpiring: number; admitted: number; target: number | null; conversion: number;
    spend: number; cpa: number | null; enquiriesDelta: number | null; admittedDelta: number | null; medianDaysToAdmit: number | null;
  };
  funnel: Named[];
  insights: {
    biggestDrop: { from: string; to: string; pct: number; lost: number } | null;
    strongest: { from: string; to: string; pct: number } | null;
    medianDaysToAdmit: number | null;
  };
  sources: Named[];
  monthly: { labels: string[]; enquiries: number[]; applications: number[]; admissions: number[] };
  attention: { tone: string; icon: string; title: string; meta: string; lead?: string; route?: string }[];
}

/** The admission automation flow (process description, not data). */
const AUTOMATION = ['Enquiry', 'WhatsApp AI', 'Lead created', 'Counsellor assigned', 'Visit scheduled', 'Application', 'Assessment', 'Offer', 'Admission', 'Student Master created'];

export default function AdmissionsDashboardPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const { openLead } = useLeadParam();
  const [adding, setAdding] = useState(false);
  const q = useApiQuery<Dashboard>('/admissions/dashboard', campusParam);
  const leads = usePagedQuery<Lead>('/enquiries', { ...campusParam, open: true, sort: 'created', dir: 'desc', pageSize: 8 });

  const head = (
    <CampusBanner
      title="Admissions"
      sub="Omnichannel capture through to enrolment, with the cost of each admission visible throughout."
      actions={
        <>
          <Segment items={[{ id: 'dashboard', label: 'Dashboard' }, { id: 'pipeline', label: 'Pipeline' }]} active="dashboard" onChange={(id) => id === 'pipeline' && navigate('/pipeline')} />
          {can('admissions.manage') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New enquiry</Button>}
        </>
      }
    />
  );

  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={4} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const { kpis: k, insights: ins } = q.data;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <Page>
      {head}
      <DashLayout rail={<DashRail events={false} actions={[
        { label: 'Leads', icon: 'list', to: '/leads' },
        { label: 'Enquiries', icon: 'message', to: '/enquiries' },
        { label: 'Counselling Pipeline', icon: 'layers', to: '/pipeline' },
        { label: 'Applications', icon: 'fileText', to: '/applications' },
        { label: 'Campus Visits', icon: 'mapPin', to: '/visits' },
        { label: 'Add New Student', icon: 'plus', to: '/students?new=1', show: can('students.create') },
      ]} />}>
      <Grid cols="g-4col">
        <Kpi size="hero" icon="message" label="New enquiries" value={fmt.n(k.enquiries)} delta={k.enquiriesDelta} foot="This academic year" onClick={() => navigate('/enquiries')} />
        <Kpi size="hero" icon="fileText" label="Applications" value={fmt.n(k.applications)} tone="info" foot={`${k.awaitingDocuments} awaiting documents`} onClick={() => navigate('/applications')} />
        <Kpi size="hero" icon="userCheck" label="Admissions" value={fmt.n(k.admitted)} tone="teal" delta={k.admittedDelta} foot={k.target ? `Target ${k.target} · ${pct(k.admitted, k.target)}%` : 'No target set'} />
        <Kpi size="hero" icon="target" label="Conversion" value={`${k.conversion}%`} tone="amber" foot="Enquiry to admission" onClick={() => navigate('/conversion')} />
      </Grid>
      <div className="statgrid statgrid--card mt-4">
        <Kpi size="compact" label="Qualified leads" value={fmt.n(k.qualified)} foot={`${k.qualifiedPct}% of enquiries`} onClick={() => navigate('/leads')} />
        <Kpi size="compact" label="Campus visits" value={fmt.n(k.visits)} foot={`${k.visitsThisWeek} scheduled this week`} onClick={() => navigate('/visits')} />
        <Kpi size="compact" label="Offers" value={fmt.n(k.offers)} tone={k.offersExpiring ? 'critical' : undefined}
          foot={`${k.offersExpiring} expiring within 7 days`} onClick={() => navigate('/applications?status=Offer+Made')} />
        <Kpi size="compact" label="Cost per admission" value={k.cpa != null ? fmt.money(k.cpa) : '—'} foot="Marketing spend ÷ admissions" onClick={() => navigate('/conversion')} />
      </div>
      <SchoolPulse />
      <p className="t-micro t-muted mt-2">Deltas compare the last 30 days with the 30 days before.</p>

      <div className="grid g-main mt-5">
        <Card icon="target" title="Conversion funnel" sub="Enquiry → Qualified → Visit → Application → Assessment → Offer → Admission"
          actions={<Button size="sm" iconRight="arrowRight" onClick={() => navigate('/pipeline')}>Open pipeline</Button>}>
          {k.enquiries ? <Funnel rows={q.data.funnel} onSelect={() => navigate('/pipeline')} /> : <Empty icon="target" title="No enquiries yet" />}
          <div className="divider" />
          <div className="grid g-3col g-4">
            <div className="card card--tint adm-insight">
              <div className="eyebrow">Biggest drop</div>
              <div className="t-sm t-bold mt-1">{ins.biggestDrop ? `${ins.biggestDrop.from} → ${ins.biggestDrop.to}` : '—'}</div>
              <div className="t-micro t-muted">{ins.biggestDrop ? `${100 - ins.biggestDrop.pct}% of ${ins.biggestDrop.from.toLowerCase()} leads do not reach ${ins.biggestDrop.to.toLowerCase()}` : 'Not enough data yet'}</div>
            </div>
            <div className="card card--tint adm-insight">
              <div className="eyebrow">Strongest step</div>
              <div className="t-sm t-bold mt-1">{ins.strongest ? `${ins.strongest.from} → ${ins.strongest.to}` : '—'}</div>
              <div className="t-micro t-muted">{ins.strongest ? `${ins.strongest.pct}% move on to ${ins.strongest.to.toLowerCase()}` : 'Not enough data yet'}</div>
            </div>
            <div className="card card--tint adm-insight">
              <div className="eyebrow">Time to admit</div>
              <div className="t-sm t-bold mt-1">{ins.medianDaysToAdmit != null ? `${ins.medianDaysToAdmit} days median` : '—'}</div>
              <div className="t-micro t-muted">From first enquiry to enrolment</div>
            </div>
          </div>
        </Card>
        <div className="col g-4">
          <Card icon="target" title="Enquiries by source" sub={q.data.sources[0] ? `${q.data.sources[0].label} is the largest single channel` : undefined}>
            {q.data.sources.length
              ? <Chart svg={charts.hbar({ rows: q.data.sources.map((s) => ({ label: s.label, value: s.value, color: SOURCE_COLOR[s.label] })), labelW: 100, rowH: 30, label: 'Enquiries by source' })} />
              : <Empty icon="chart" title="No enquiries yet" />}
          </Card>
          <Card icon="alert" title="Follow-ups needing attention" flush>
            {q.data.attention.length ? (
              <div>
                {q.data.attention.map((a) => (
                  <AlertItem key={a.title} tone={a.tone} icon={a.icon} title={a.title} meta={a.meta}
                    onClick={a.lead ? () => openLead(a.lead!) : undefined} to={a.route} />
                ))}
              </div>
            ) : <Empty icon="check" title="Nothing needs attention" sub="Every lead has an owner and no follow-up is overdue." />}
          </Card>
        </div>
      </div>

      <div className="grid g-2col g-4 mt-5">
        <Card icon="target" title="Enquiries and admissions by month">
          <Chart svg={charts.bar({
            labels: q.data.monthly.labels,
            series: [{ name: 'Enquiries', values: q.data.monthly.enquiries, color: 'var(--navy)' }, { name: 'Admissions', values: q.data.monthly.admissions, color: 'var(--teal)' }],
            height: 230, label: 'Enquiries and admissions by month',
          })} />
          <div className="mt-3"><Legend items={[{ label: 'Enquiries', color: 'var(--navy)' }, { label: 'Admissions', color: 'var(--teal)' }]} /></div>
        </Card>
        <Card icon="target" title="Admission automation" sub="What happens without anyone touching it">
          <div className="col g-2">
            {AUTOMATION.map((s, i) => (
              <div className="row g-3" key={s}>
                <span className={cx('stepper__num adm-auto__num', i < 4 && 'adm-auto__num--auto')}>{i + 1}</span>
                <span className="t-sm grow">{s}</span>
                {i < AUTOMATION.length - 1 ? <Icon name="arrowDown" size={13} className="t-faint" /> : <Icon name="check" size={14} className="t-success" />}
              </div>
            ))}
          </div>
          {can('prototype.view') && (
            <div className="mt-4"><Button block icon="message" onClick={() => navigate('/whatsapp-ai')}>See the WhatsApp AI that starts it</Button></div>
          )}
        </Card>
      </div>

      <div className="mt-5">
        <Card icon="target" title="Leads" sub={leads.data ? `${leads.data.meta.total} active` : undefined} flush
          actions={<Button size="sm" iconRight="arrowRight" onClick={() => navigate('/leads')}>Open full list</Button>}>
          {leads.error ? <ErrorState error={leads.error} onRetry={() => leads.refetch()} /> : (
            <LeadsTable rows={leads.data?.rows} loading={leads.isLoading} onOpen={openLead} emptyText="No open leads." />
          )}
        </Card>
      </div>
      {adding && <LeadFormModal onClose={() => setAdding(false)} onCreated={(code) => { setAdding(false); openLead(code); }} />}
      <LeadProfileHost />
      </DashLayout>
    </Page>
  );
}
