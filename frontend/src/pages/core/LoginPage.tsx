import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { BrandDivider, Button, Icon, Lotus, Modal, Svg, useToast, CAMPUS_PHOTO } from '@/components/ui';
import { fmt } from '@/lib/format';

interface PublicConfig {
  campuses: { code: string; name: string; shortName: string; place: string }[];
  academicYear: string | null;
  settings: Record<string, unknown>;
  stats: { students: number; staff: number; campuses: number };
  demoAccounts?: { email: string; fullName: string; title: string; role: string; roleName: string }[];
  environment: string;
}

const MASCOT = `<svg width="58" height="58" viewBox="0 0 64 64" role="img" aria-label="AI campus assistant">
<ellipse cx="32" cy="59" rx="16" ry="3.4" fill="#0D2B45" opacity=".16"/>
<rect x="19" y="33" width="26" height="22" rx="9" fill="#F2F6FA" stroke="#C5D6E4" stroke-width="1.5"/>
<rect x="27" y="41" width="10" height="9" rx="3" fill="#E1ECF4"/>
<rect x="11" y="36" width="8" height="15" rx="4" fill="#E7EFF6" stroke="#C5D6E4" stroke-width="1.2"/>
<rect x="45" y="36" width="8" height="15" rx="4" fill="#E7EFF6" stroke="#C5D6E4" stroke-width="1.2"/>
<rect x="15" y="12" width="34" height="24" rx="11" fill="#FBFDFF" stroke="#C5D6E4" stroke-width="1.6"/>
<rect x="19" y="17" width="26" height="14" rx="7" fill="#0D2B45"/>
<circle cx="27" cy="24" r="3.4" fill="#4FD1E8"/><circle cx="37" cy="24" r="3.4" fill="#4FD1E8"/>
<circle cx="28.2" cy="22.8" r="1.1" fill="#fff"/><circle cx="38.2" cy="22.8" r="1.1" fill="#fff"/>
<rect x="30.4" y="5" width="3.2" height="7" rx="1.6" fill="#B87008"/><circle cx="32" cy="4" r="3" fill="#E8B765"/>
<circle cx="32" cy="46" r="2.2" fill="#4FD1E8" opacity=".8"/></svg>`;

// The five wireframe role tiles, in order.
const TILES: { role: string; label: string; icon: string }[] = [
  { role: 'principal', label: 'Management', icon: 'user' },
  { role: 'teacher', label: 'Teacher', icon: 'users' },
  { role: 'parent', label: 'Parent', icon: 'heart' },
  { role: 'office', label: 'Office', icon: 'building' },
  { role: 'staff', label: 'Staff', icon: 'idCard' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const { t, langs, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const config = useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/public/config'), staleTime: 5 * 60_000 });
  const demo = config.data?.demoAccounts ?? [];
  const pickedAccount = demo.find((d) => d.role === picked) ?? null;

  useEffect(() => {
    document.title = 'Sign in — Holy Sai Smart School 360';
  }, []);

  const pick = (role: string, email?: string) => {
    const acc = email ? demo.find((d) => d.email === email) : demo.find((d) => d.role === role);
    setPicked(role);
    if (acc) setIdentifier(acc.email);
    setError(null);
    setMoreOpen(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError('Enter your email or mobile number and your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await login(identifier.trim(), password);
      toast(`Welcome, ${user.fullName}`, 'success', 'check');
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : user.role.homeRoute, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const stats = config.data?.stats;

  return (
    <section className="home" aria-label="Holy Sai Smart School 360 — welcome and sign in">
      <div className="home__photo" style={{ backgroundImage: `url(${CAMPUS_PHOTO})` }} aria-hidden="true" />
      <header className="home__nav">
        <div className="home__brand">
          <Lotus size={46} />
          <span className="col">
            <span className="home__brandname">Holy Sai</span>
            <span className="home__brandtag">International School</span>
          </span>
        </div>
        <nav className="home__links">
          {['Learn', 'Grow', 'Belong', 'Lead'].map((l, i) => (
            <span key={l} style={{ display: 'contents' }}>
              {i > 0 && <span className="navlink__sep">|</span>}
              <button className="navlink" onClick={() => setInfo(`${l} — the public website section lives on the school website.`)}>{l}</button>
            </span>
          ))}
        </nav>
        <div className="spacer" />
        <div className="langpill">
          {langs.map((l) => (
            <button key={l.id} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.label}</button>
          ))}
        </div>
      </header>

      <p className="script script--tr">A Brighter Tomorrow<br />Begins Here</p>
      <p className="script script--br">Growing Minds.<br />Inspiring Futures.</p>

      <div className="home__body">
        <div className="home__left">
          <div className="shot">
            <img src="/homescreen.webp" width={1448} height={1086} fetchPriority="high" decoding="async" alt="Holy Sai International campus: students walking to the entrance, with Student Success, Connected Parents, Safer Campus and Smarter Operations highlighted." />
          </div>
          <div className="herofallback">
            <p className="hero__eyebrow">A Brighter Tomorrow Begins Here</p>
            <h1 className="hero__title">Holy Sai International.<em>Growing Minds. Inspiring Futures.</em></h1>
            <p className="hero__lede">Admissions, academics, parents, safety, finance, workforce and intelligence — connected around every student.</p>
            <div className="statsbar">
              {[
                ['users', stats ? `${fmt.n(stats.students)}` : '—', 'Students'],
                ['graduation', stats ? `${fmt.n(stats.staff)}` : '—', 'Staff'],
                ['building', stats ? String(stats.campuses) : '—', 'Campuses'],
                ['globe', 'Cambridge', 'Primary to A Level'],
              ].map(([ico, v, l]) => (
                <span className="stat" key={l}>
                  <span className="stat__ico"><Icon name={ico} size={20} /></span>
                  <span className="col"><span className="stat__value">{v}</span><span className="stat__label">{l}</span></span>
                </span>
              ))}
            </div>
          </div>
          <div className="row wrap g-3 mt-4" style={{ padding: '0 var(--s-2)' }}>
            <span className="t-micro t-bold" style={{ color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '.14em' }}>Brand Values:</span>
            {[['book', 'Educational'], ['lotus', 'Elegant'], ['sparkle', 'Inspiring'], ['trending', 'Modern'], ['shieldCheck', 'Trustworthy']].map(([i, l]) => (
              <span key={l} className="badge" style={{ background: 'rgba(255,255,255,.1)', borderColor: 'rgba(254,219,110,.3)', color: '#FFF' }}>
                <Icon name={i} size={13} />{l}
              </span>
            ))}
            <span className="script-font" style={{ color: 'var(--gold)', fontSize: 18, marginLeft: 'auto' }}>Learning Beyond Limits</span>
          </div>
        </div>

        <div className="home__right">
          <form className="logincard" onSubmit={submit} noValidate>
            <div className="row between">
              <div>
                <p className="logincard__welcome">Welcome to</p>
                <h2 className="logincard__title">Holy Sai International</h2>
                <p className="logincard__sub">Smart School 360 · Connected Digital Campus</p>
              </div>
              <Lotus size={42} />
            </div>
            <BrandDivider />
            <button type="button" className="ctxrow" onClick={() => setInfo('Campus and academic year are chosen after sign-in, from the header.')}>
              <Icon name="building" size={17} />
              <span className="ctxrow__text grow">Academic Year {config.data?.academicYear ?? '—'} &nbsp;|&nbsp; <b>Holy Sai International</b></span>
              <Icon name="chevronDown" size={15} />
            </button>

            <div className="col g-3 mt-4">
              <div className="ifield">
                <span className="ifield__ico"><Icon name="mail" size={17} /></span>
                <input className="input" type="text" name="username" autoComplete="username" aria-label="Email or mobile number"
                  placeholder="Email or mobile number" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
              </div>
              <div className="ifield">
                <span className="ifield__ico"><Icon name="lock" size={17} /></span>
                <input className="input" type={showPw ? 'text' : 'password'} name="password" autoComplete="current-password" aria-label="Password"
                  placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="iconbtn ifield__eye" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((s) => !s)}>
                  <Icon name="eye" size={17} />
                </button>
              </div>
              <div className="row between wrap g-2">
                <label className="check"><input type="checkbox" defaultChecked /> Remember me on this device</label>
                <button type="button" className="t-sm" style={{ color: 'var(--magenta)' }}
                  onClick={() => setInfo('Password reset: contact the school office, who can verify your identity and issue a reset. Self-service reset activates once an email/SMS provider is configured.')}>
                  Forgot password?
                </button>
              </div>
              {error && (
                <div className="banner banner--critical login-error" role="alert">
                  <Icon name="alert" size={17} />
                  <div className="grow">{error}</div>
                </div>
              )}
              <Button type="submit" variant="primary" block iconRight="arrowRight" loading={busy} className="logincard__btn">
                Sign in to Campus
              </Button>
            </div>

            {demo.length > 0 && (
              <>
                <div className="orline mt-5">Or continue as</div>
                <div className="roletiles mt-3">
                  {TILES.filter((tile) => demo.some((d) => d.role === tile.role)).map((tile) => {
                    const acc = demo.find((d) => d.role === tile.role)!;
                    return (
                      <button type="button" key={tile.role} className="roletile" data-role={tile.role} aria-pressed={picked === tile.role}
                        title={`${acc.fullName} · ${acc.title}`} onClick={() => pick(tile.role)}>
                        <span className="roletile__ico"><Icon name={tile.icon} size={16} /></span>
                        <span className="roletile__label">{tile.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="t-micro t-muted t-center mt-3">
                  {pickedAccount ? (
                    <>Signing in as <strong>{pickedAccount.fullName}</strong> · {pickedAccount.title}</>
                  ) : (
                    <>Choose a demo account, then enter the demo password.</>
                  )}
                  {' · '}
                  <button type="button" className="t-micro" style={{ color: 'var(--magenta)', fontWeight: 600 }} onClick={() => setMoreOpen(true)}>More accounts</button>
                </p>
                <p className="demo-hint">Development build: demo accounts use the password set in <code>SEED_DEMO_PASSWORD</code>.</p>
              </>
            )}
          </form>

          <div className="aicard">
            <Svg html={MASCOT} />
            <div className="grow">
              <div className="aicard__title">Need help entering the campus?</div>
              <div className="aicard__text">Ask our AI Campus Assistant</div>
              <div className="aicard__actions">
                <Button variant="primary" size="sm" icon="sparkle" onClick={() => setInfo('The AI Campus Assistant answers from approved school documents once you sign in.')}>Ask AI</Button>
                <Button size="sm" icon="phone" onClick={() => setInfo('Holy Sai International School front office — available Monday to Saturday, 8:00 am to 5:00 pm.')}>Contact School</Button>
                <Button size="sm" icon="helpCircle" onClick={() => setInfo('Sign in with the email or mobile number registered with the school. Parents see only their own children; staff see the modules their role allows.')}>{t('Help')}</Button>
              </div>
            </div>
          </div>

          <div className="row center">
            <span className="illustrative" style={{ background: 'rgba(255,255,255,.14)', color: '#FCE4EC' }}>
              <Icon name="lotus" size={14} />Holy Sai International School · Growing Minds. Inspiring Futures.
            </span>
          </div>
        </div>
      </div>

      <Modal open={!!info} onClose={() => setInfo(null)} title="Holy Sai Smart School 360" foot={<Button variant="primary" onClick={() => setInfo(null)}>Understood</Button>}>
        <p className="t-sm">{info}</p>
      </Modal>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Demo accounts" sub="Sample accounts for every role. Development builds only." size="wide"
        foot={<Button onClick={() => setMoreOpen(false)}>Close</Button>}>
        <div className="col g-2">
          {demo.map((d) => (
            <button key={d.email} className="optioncard" onClick={() => pick(d.role, d.email)}>
              <span className="avatar">{fmt.initials(d.fullName)}</span>
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="t-sm t-bold">{d.fullName} <span className="badge badge--info" style={{ marginLeft: 6 }}>{d.roleName}</span></span>
                <span className="t-xs t-muted t-clip">{d.title} · {d.email}</span>
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          ))}
        </div>
      </Modal>
    </section>
  );
}
