import { useState } from 'react';
import { fmt } from '@/lib/format';
import { Badge, Banner, Button, Card, Flow, Icon, Page, PageHead, StatStrip } from '@/components/ui';
import { DAY_IN_LIFE, ROLE_TONE } from './prototypeData';
import { LabelledPoints } from './shared';
import { useLiveFigures } from './useLiveFigures';

export default function DayInLifePage() {
  const [step, setStep] = useState(0);
  const { live, query } = useLiveFigures();
  const steps = DAY_IN_LIFE;
  const s = steps[step];
  const last = step >= steps.length - 1;
  const body = s.live && live ? s.live(live) : s.body;

  return (
    <Page>
      <PageHead
        title="A day in the life"
        sub="One day at Holy Sai, following the same event through every role that touches it. This is the connected story, not twelve separate screens."
        actions={<>
          <Button icon="zap" to="/automations">Automation flows</Button>
          <Button variant="primary" icon={last ? 'refresh' : 'play'} onClick={() => setStep(last ? 0 : step + 1)}>{last ? 'Start again' : 'Play next'}</Button>
        </>}
      />

      {live ? (
        <StatStrip items={[
          { label: 'Students present now', value: `${fmt.n(live.present)} / ${fmt.n(live.students)}` },
          { label: 'Staff in today', value: `${live.staffPresent} / ${live.staffTotal}` },
          { label: 'Open Early Warning signals', value: live.openSignals },
          { label: 'Approvals waiting', value: live.approvals },
        ]} />
      ) : query.error ? <Banner tone="neutral" icon="info">Live figures are unavailable right now, so the story uses its standard wording.</Banner> : null}

      <div className="mt-4">
        <Card flush>
          <div style={{ overflowX: 'auto', padding: 20 }}>
            <div className="row" style={{ minWidth: 920, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 24, right: 24, top: 21, height: 2, background: 'var(--border)' }} />
              <div style={{ position: 'absolute', left: 24, top: 21, height: 2, background: 'var(--teal)', width: `calc((100% - 48px) * ${step / (steps.length - 1)})` }} />
              {steps.map((x, i) => {
                const done = i <= step;
                return (
                  <button key={x.time} type="button" className="col center" aria-label={`${x.time} — ${x.title}`} aria-current={i === step ? 'step' : undefined}
                    style={{ flex: 1, alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }} onClick={() => setStep(i)}>
                    <span style={{
                      width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center',
                      background: done ? 'var(--navy)' : 'var(--surface)', border: `2px solid ${done ? 'var(--navy)' : 'var(--border-strong)'}`,
                      color: done ? 'var(--text-invert)' : 'var(--text-muted)', boxShadow: i === step ? '0 0 0 5px var(--brand-tint-2)' : undefined,
                    }}><Icon name={x.icon} size={19} /></span>
                    <span className={`t-micro t-num ${i === step ? 't-bold t-strong' : 't-muted'}`}>{x.time}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g-main mt-4">
        <Card icon="grid"
          title={`${s.time} — ${s.title}`}
          sub={s.role}
          actions={<>
            <Badge tone={ROLE_TONE[s.role] ?? 'neutral'}>{s.role}</Badge>
            <Button size="sm" variant="primary" to={s.route} iconRight="arrowRight">Open the screen</Button>
          </>}
        >
          <p style={{ fontSize: 16, lineHeight: 1.65 }}>{body}</p>
          {s.live && live && <p className="t-micro t-muted mt-2">Figures are live from the Command Center.</p>}
          <div className="divider" />
          <div className="eyebrow mb-3">What the system does, without anyone asking</div>
          <Flow steps={s.chain.map((c, i) => ({ label: c, meta: i === s.chain.length - 1 ? 'Recorded' : 'Automatic', state: 'done' as const }))} />
          <div className="row g-2 mt-5 wrap">
            <Button icon="arrowLeft" disabled={step === 0} onClick={() => setStep(step - 1)}>Previous</Button>
            <Button variant="primary" iconRight="arrowRight" onClick={() => setStep(last ? 0 : step + 1)}>{last ? 'Back to the start' : 'Next moment'}</Button>
          </div>
        </Card>
        <div className="col g-4">
          <Card icon="grid" title="The whole day" flush>
            <div>
              {steps.map((x, i) => (
                <button key={x.time} type="button" className={`alert-item ${i === step ? 'alert-item--info' : ''}`} onClick={() => setStep(i)}
                  style={i === step ? { background: 'var(--surface-alt)' } : undefined}>
                  <span className="t-micro t-num t-muted none" style={{ width: 42, paddingTop: 3 }}>{x.time}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="alert-item__title" style={{ display: 'block' }}>{x.title}</span>
                    <span className="alert-item__meta" style={{ display: 'block' }}>{x.role}</span>
                  </span>
                  {i <= step ? <Icon name="check" size={15} className="t-success" /> : <Icon name="chevronRight" size={15} className="t-faint" />}
                </button>
              ))}
            </div>
          </Card>
          <Card icon="grid" title="What this demonstrates">
            <LabelledPoints rows={[
              ['One event, many audiences', 'A single gate scan informs the parent, the register, the attendance analytics and the Command Center.'],
              ['Nothing is re-keyed', 'Boarding, attendance, marks, payments and overtime are each entered once and used everywhere.'],
              ['People stay in charge', 'Signals and AI drafts stop at a person. The system proposes; a teacher or manager decides.'],
              ['Evidence accumulates', 'By the end of the day the Student 360 profile is richer without anyone filling in a form for it.'],
            ]} />
          </Card>
        </div>
      </div>
    </Page>
  );
}
