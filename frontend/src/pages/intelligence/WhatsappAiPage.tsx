import { useState } from 'react';
import { Button, Card, Icon, Illustrative, Page, PageHead, Timeline } from '@/components/ui';
import { WHATSAPP, WHATSAPP_CRM, WHATSAPP_GUARDRAILS } from './prototypeData';
import { LabelledPoints } from './shared';
import { useLiveFigures } from './useLiveFigures';

export default function WhatsappAiPage() {
  const [shown, setShown] = useState(2);
  const { live } = useLiveFigures();
  const done = shown >= WHATSAPP.length;
  const next = () => setShown(done ? 2 : shown + 2);
  const msgs = WHATSAPP.slice(0, shown);
  const crmSteps = WHATSAPP_CRM.slice(0, Math.min(WHATSAPP_CRM.length, shown === 2 ? 2 : shown === 4 ? 3 : 5));

  return (
    <Page>
      <PageHead
        title="WhatsApp AI Assistant"
        sub="The first thing a prospective parent meets. It answers from approved information, and every conversation creates or updates a CRM lead."
        actions={<>
          <Button icon="target" to="/admissions">Open the CRM</Button>
          <Button variant="primary" icon="play" onClick={next}>{done ? 'Replay' : 'Continue conversation'}</Button>
        </>}
      />
      <div className="row g-2 mb-4 wrap">
        <Illustrative>Prototype conversation — the WhatsApp channel is not connected</Illustrative>
        {live?.whatsappEnquiries != null && <span className="t-xs t-muted">In the live CRM, WhatsApp is the source of {live.whatsappEnquiries} enquiries.</span>}
      </div>
      <div className="row g-6 wrap" style={{ alignItems: 'flex-start' }}>
        <div className="none" style={{ maxWidth: '100%' }}>
          <div className="device">
            <div className="device__screen">
              <div className="device__status"><span>9:41</span><span className="row g-2"><Icon name="activity" size={12} /><Icon name="zap" size={12} /></span></div>
              <div className="appbar" style={{ background: 'var(--magenta-deep)', color: 'var(--text-on-navy)' }}>
                <Icon name="chevronLeft" size={18} />
                <span className="avatar avatar--sm avatar--gold none">HS</span>
                <span className="col grow"><span className="t-sm t-bold">Holy Sai International</span>
                  <span className="t-micro">Business account · replies instantly</span></span>
                <Icon name="phone" size={17} />
              </div>
              <div className="device__scroll" style={{ background: 'var(--bg-sunken)', padding: '14px 12px' }} aria-live="polite">
                <div className="chat">
                  {msgs.map((m, i) => m.from === 'parent' ? (
                    <div key={i} className="bubble bubble--out" style={{ maxWidth: '84%' }}>
                      {m.text}<div className="bubble__meta t-right">{m.time} · read</div>
                    </div>
                  ) : (
                    <div key={i} className="bubble bubble--in" style={{ maxWidth: '88%' }}>
                      {m.text}
                      {m.quick && (
                        <div className="quick-replies mt-3">
                          {m.quick.map((q) => (
                            <button key={q} type="button" className="btn btn--sm btn--ghost" onClick={next}>{q}</button>
                          ))}
                        </div>
                      )}
                      <div className="bubble__meta">{m.time}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="row g-2" style={{ padding: '10px 12px', background: 'var(--surface-alt)' }} aria-hidden="true">
                <div className="input grow" style={{ borderRadius: 'var(--r-pill)', display: 'flex', alignItems: 'center', color: 'var(--text-faint)' }}>Message</div>
                <span className="avatar avatar--sm none"><Icon name="send" size={15} /></span>
              </div>
            </div>
          </div>
          <div className="device__label">Parent view · WhatsApp</div>
        </div>
        <div className="grow col g-4" style={{ minWidth: 0, flexBasis: 320 }}>
          <Card icon="grid" title="What happened in the CRM" sub="Every message updates the record behind the scenes">
            <Timeline items={crmSteps} />
          </Card>
          <Card icon="grid" title="Guardrails">
            <LabelledPoints rows={WHATSAPP_GUARDRAILS} icon="shield" />
          </Card>
        </div>
      </div>
    </Page>
  );
}
