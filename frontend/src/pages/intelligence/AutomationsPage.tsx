import { Button, Card, Icon, Page, PageHead } from '@/components/ui';
import { AUTOMATIONS, HUMAN_GATES } from './prototypeData';
import { useLiveFigures } from './useLiveFigures';

export default function AutomationsPage() {
  const { live } = useLiveFigures();
  const today: Record<string, string | null> = live ? {
    attendance: `Today: ${live.marked} of ${live.students} students marked · ${live.openSignals} open Early Warning signals`,
    bus: live.delayedRoutes ? `Now: ${live.delayedRoutes}` : 'Now: no routes reported late',
    admission: live.enquiriesThisMonth != null ? `This month: ${live.enquiriesThisMonth} enquiries${live.whatsappEnquiries != null ? ` · ${live.whatsappEnquiries} from WhatsApp in total` : ''}` : null,
    payroll: `Now: ${live.approvals} approvals waiting across modules`,
    academic: `Now: ${live.awaitingReview} signals awaiting a teacher decision`,
  } : {};

  return (
    <Page>
      <PageHead
        title="Automation Flows"
        sub="The chains that run without anyone asking. Each one ends at a person or at a record, never at an unreviewed decision."
        actions={<Button icon="play" to="/day-in-life">See it as a day</Button>}
      />
      <div className="col g-4">
        {AUTOMATIONS.map((f) => (
          <Card key={f.id} title={<span className="row g-2"><Icon name={f.icon} size={16} />{f.title}</span>}
            actions={<Button size="sm" to={f.route} iconRight="arrowRight">Open the module</Button>}>
            <div className="row wrap g-2" style={{ alignItems: 'stretch' }}>
              {f.steps.map((s, i) => {
                const lastStep = i === f.steps.length - 1;
                return (
                  <div className="row g-2" style={{ alignItems: 'center' }} key={s}>
                    <div className="card card--tint" style={{
                      padding: '10px 14px', borderRadius: 'var(--r-sm)',
                      ...(lastStep ? { background: 'var(--success-tint)', borderColor: 'var(--success-line)' } : i === 0 ? { background: 'var(--navy)', borderColor: 'var(--navy)' } : {}),
                    }}>
                      <span className="t-xs t-bold" style={i === 0 ? { color: 'var(--text-invert)' } : undefined}>{s}</span>
                    </div>
                    {!lastStep && <span className="t-faint"><Icon name="arrowRight" size={14} /></span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 t-xs t-muted">{f.note}</div>
            {today[f.id] && <div className="mt-2 t-xs row g-2"><Icon name="activity" size={13} className="t-muted" /><span>{today[f.id]}</span></div>}
          </Card>
        ))}
      </div>
      <div className="mt-4">
        <Card icon="grid" title="Where a person always intervenes">
          <div className="grid g-2col g-3">
            {HUMAN_GATES.map(([t, d]) => (
              <div className="card card--tint" style={{ padding: 14 }} key={t}>
                <div className="row g-2"><Icon name="user" size={15} /><span className="t-sm t-bold">{t}</span></div>
                <div className="t-micro t-muted mt-1">{d}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
