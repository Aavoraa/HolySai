import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { Badge, Button, ErrorState, Page, PageHead, Segment, Skeleton } from '@/components/ui';
import { LeadFormModal } from './LeadForms';
import { LeadProfileHost } from './LeadProfile';
import { PipeCard, useLeadParam } from './shared';
import type { Lead } from './types';

interface Column { stage: string; count: number; leads: Lead[] }

export default function PipelinePage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const { openLead } = useLeadParam();
  const [adding, setAdding] = useState(false);
  const q = useApiQuery<Column[]>('/enquiries/pipeline', campusParam);

  return (
    <Page>
      <PageHead
        title="Counselling pipeline"
        sub="New Lead → Contacted → Qualified → Visit Scheduled → Visit Completed → Application → Assessment → Offer → Enrolled"
        actions={
          <>
            <Segment items={[{ id: 'dashboard', label: 'Dashboard' }, { id: 'pipeline', label: 'Pipeline' }]} active="pipeline" onChange={(id) => id === 'dashboard' && navigate('/admissions')} />
            {can('admissions.manage') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add lead</Button>}
          </>
        }
      />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="card card--pad">
          <div className="pipeline" aria-busy={q.isLoading || undefined}>
            {q.isLoading
              ? Array.from({ length: 9 }).map((_, i) => <div key={i} className="pipeline__col"><Skeleton height={18} /><Skeleton height={70} style={{ marginTop: 'var(--s-3)' }} /></div>)
              : q.data!.map((col) => (
                <section className="pipeline__col" key={col.stage} aria-label={`${col.stage}: ${col.count} leads`}>
                  <div className="pipeline__colhead">
                    <span className="pipeline__coltitle">{col.stage}</span>
                    <span className="row g-1">
                      {col.leads.some((l) => l.overdue) && (
                        <Badge tone="critical" title="Leads in this column with an overdue follow-up">{col.leads.filter((l) => l.overdue).length} overdue</Badge>
                      )}
                      <span className="pipeline__count">{col.count}</span>
                    </span>
                  </div>
                  {col.leads.length
                    ? col.leads.map((l) => <PipeCard key={l.id} lead={l} onOpen={openLead} />)
                    : <div className="adm-pipeline__empty">No leads at this stage</div>}
                </section>
              ))}
          </div>
          <p className="t-xs t-muted mt-3">Each card shows the next step and its owner; overdue follow-ups are flagged in red. Open a lead to change its stage — every move is recorded with a note in the stage history. Enrolled shows the last 60 days; lost leads are listed under Leads.</p>
        </div>
      )}
      {adding && <LeadFormModal onClose={() => setAdding(false)} onCreated={(code) => { setAdding(false); openLead(code); }} />}
      <LeadProfileHost />
    </Page>
  );
}
