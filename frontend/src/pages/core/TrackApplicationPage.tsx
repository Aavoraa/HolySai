import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Badge, Banner, Button, Card, Icon, TextField, errorMessage } from '@/components/ui';
import { fmt } from '@/lib/format';

interface Status {
  applicationNo: string; student: string; grade: string; campus: string; status: string; closed: boolean; updatedAt: string;
  assessmentAt: string | null; offerExpiresOn: string | null; nextStep: string;
  steps: { status: string; state: 'done' | 'current' | 'todo'; at: string | null }[];
}

const TONE: Record<string, string> = { Enrolled: 'success', Accepted: 'success', 'Offer Made': 'info', Rejected: 'critical', Withdrawn: 'neutral' };

/** Public page (no sign-in): families check an admission application by its number and phone. */
export default function TrackApplicationPage() {
  const [applicationNo, setApplicationNo] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<Status | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (applicationNo.trim().length < 4) er.applicationNo = 'Enter the application number, e.g. APP-2026-0101';
    if (phone.replace(/\D/g, '').length < 10) er.phone = 'Enter the 10-digit mobile number given on the form';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true); setError(''); setData(null);
    try {
      setData(await api.get<Status>('/public/application-status', { applicationNo: applicationNo.trim(), phone }));
    } catch (err) {
      setError(errorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 'var(--s-6) var(--s-4)' }}>
      <div className="col g-4" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row between wrap g-2">
          <div>
            <h1 className="t-h2" style={{ margin: 0 }}>Track your application</h1>
            <p className="t-sm t-muted" style={{ margin: 0 }}>Holy Sai International · Admissions</p>
          </div>
          <Link to="/login" className="t-sm"><Icon name="arrowLeft" size={14} /> Back to sign in</Link>
        </div>

        <Card>
          <form className="col g-3" onSubmit={submit} noValidate>
            <TextField label="Application number" required value={applicationNo} onChange={(v) => { setApplicationNo(v); setErrors((x) => ({ ...x, applicationNo: '' })); }}
              placeholder="APP-2026-0101" error={errors.applicationNo} maxLength={30} />
            <TextField label="Parent's mobile number" required value={phone} onChange={(v) => { setPhone(v); setErrors((x) => ({ ...x, phone: '' })); }}
              placeholder="The number on the admission form" error={errors.phone} maxLength={20} type="tel" />
            {error && <Banner tone="critical" icon="alert">{error}</Banner>}
            <Button type="submit" variant="primary" icon="search" loading={busy}>Check status</Button>
          </form>
        </Card>

        {data && (
          <Card title={`${data.student} · ${data.grade}`} sub={`${data.applicationNo} · ${data.campus}`}
            actions={<Badge tone={TONE[data.status] ?? 'warning'}>{data.status}</Badge>}>
            <div className="col g-4">
              <Banner tone={data.closed ? 'neutral' : data.status === 'Enrolled' ? 'success' : undefined} icon={data.closed ? 'info' : 'arrowRight'}>
                <span>
                  {data.nextStep}
                  {data.assessmentAt && <> <strong>Assessment: {fmt.dateTime(data.assessmentAt)}.</strong></>}
                  {data.offerExpiresOn && <> <strong>Offer valid until {fmt.date(data.offerExpiresOn)}.</strong></>}
                </span>
              </Banner>
              {!data.closed && (
                <ol className="col g-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Application progress">
                  {data.steps.map((s, i) => (
                    <li key={s.status} className="row g-3" style={{ alignItems: 'center', opacity: s.state === 'todo' ? 0.55 : 1 }}
                      aria-current={s.state === 'current' ? 'step' : undefined}>
                      <span style={{
                        width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none',
                        background: s.state === 'done' ? 'var(--teal)' : s.state === 'current' ? 'var(--magenta)' : 'var(--bg-sunken)',
                        color: s.state === 'todo' ? 'var(--text-muted)' : '#fff',
                      }}>
                        {s.state === 'todo' ? <span className="t-xs">{i + 1}</span> : <Icon name={s.state === 'done' ? 'check' : 'clock'} size={14} />}
                      </span>
                      <span className="grow t-sm" style={{ fontWeight: s.state === 'current' ? 700 : 400 }}>{s.status}</span>
                      {s.at && <span className="t-xs t-muted">{fmt.date(s.at)}</span>}
                    </li>
                  ))}
                </ol>
              )}
              <p className="t-micro t-muted" style={{ margin: 0 }}>Last updated {fmt.dateTime(data.updatedAt)}. For questions, contact the admissions office.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
