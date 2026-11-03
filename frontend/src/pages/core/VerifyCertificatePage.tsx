import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Banner, Card, Dl, Icon, Skeleton, errorMessage } from '@/components/ui';
import { fmt } from '@/lib/format';

interface Verified { valid: boolean; code: string; type: string; student: string; admissionNo: string; issuedAt: string | null; status: string }

/** Public page (no sign-in) opened from the QR code on a printed certificate. */
export default function VerifyCertificatePage() {
  const { code = '' } = useParams();
  const q = useQuery({ queryKey: ['public-verify', code], queryFn: () => api.get<Verified>(`/public/certificates/${encodeURIComponent(code)}`), retry: false });
  const c = q.data;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 'var(--s-6) var(--s-4)' }}>
      <div className="col g-4" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="row between wrap g-2">
          <div>
            <h1 className="t-h2" style={{ margin: 0 }}>Certificate check</h1>
            <p className="t-sm t-muted" style={{ margin: 0 }}>Holy Sai International School</p>
          </div>
          <Link to="/login" className="t-sm"><Icon name="arrowLeft" size={14} /> Sign in</Link>
        </div>
        <Card>
          {q.isLoading ? <Skeleton height={160} /> : q.error ? (
            <Banner tone="critical" icon="alert">{errorMessage(q.error)}</Banner>
          ) : c && (
            <div className="col g-4">
              <Banner tone={c.valid ? 'success' : 'critical'} icon={c.valid ? 'shieldCheck' : 'alert'}>
                {c.valid ? <><strong>Genuine.</strong> This certificate was issued by the school and is valid.</> : <><strong>Not valid.</strong> This certificate is {c.status.toLowerCase()} — contact the school office.</>}
              </Banner>
              <Dl items={[
                ['Certificate', `${c.type} certificate`],
                ['Issued to', `${c.student} (${c.admissionNo})`],
                ['Issued on', c.issuedAt ? fmt.date(c.issuedAt) : '—'],
                ['Verification code', c.code],
              ]} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
