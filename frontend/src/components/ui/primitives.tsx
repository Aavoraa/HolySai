/**
 * Primitive components. Each mirrors a builder from the wireframe's HS.ui and
 * renders the same markup + CSS classes, so screens look exactly as approved.
 */
import { forwardRef, useEffect, useId, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n/I18nProvider';
import { routeMeta } from '@/layouts/routeMeta';
import { iconPaths, brandDivider } from '@/lib/legacy-icons';
import { charts } from '@/lib/legacy-charts';
import { cx, fmt } from '@/lib/format';
import { LotusArt, LotusDivider } from './LotusArt';
import { riskTone, statusTone, toneFor, type Tone } from '@/lib/tones';

// ---------------------------------------------------------------------------
// Icons & brand
// ---------------------------------------------------------------------------
export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: iconPaths[name] ?? '<circle cx="12" cy="12" r="9"/>' }}
    />
  );
}

/** Trusted, internally generated SVG markup (charts, brand marks). */
export function Svg({ html, className, style }: { html: string; className?: string; style?: CSSProperties }) {
  return <span className={className} style={style ?? { display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** School lotus emblem (cropped from the official logo lockup). */
export function Lotus({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/logo-mark.webp"
      alt="Holy Sai International School"
      width={size}
      height={size}
      className="brandmark"
      style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }}
    />
  );
}

/** Full horizontal logo lockup — emblem plus wordmark. */
export function LogoLockup({ height = 48, className }: { height?: number; className?: string }) {
  return (
    <img
      src="/logo-full.webp"
      width={600}
      height={192}
      decoding="async"
      alt="Holy Sai International School"
      className={cx('brandlockup', className)}
      style={{ height, width: 'auto', objectFit: 'contain', flex: 'none' }}
    />
  );
}

export function BrandDivider() {
  return <Svg html={brandDivider()} />;
}

export function Chart({ svg, className }: { svg: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
export { charts };

export function Legend({ items }: { items: { label: string; color?: string }[] }) {
  return <Chart svg={charts.legend(items)} />;
}

// ---------------------------------------------------------------------------
// Badges, avatars, people
// ---------------------------------------------------------------------------
export function Badge({ children, tone = 'neutral', dot, icon, lg, title }: { children: ReactNode; tone?: Tone | string; dot?: boolean; icon?: string; lg?: boolean; title?: string }) {
  return (
    <span className={cx('badge', `badge--${tone}`, lg && 'badge--lg')} title={title}>
      {dot && <span className={`dot dot--${tone}`} />}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** A badge whose tone follows the shared status vocabulary. */
export function Status({ value, dot, lg, label }: { value?: string | null; dot?: boolean; lg?: boolean; label?: string }) {
  if (!value) return <span className="t-faint">—</span>;
  return <Badge tone={statusTone(value)} dot={dot} lg={lg}>{label ?? value}</Badge>;
}

export function Risk({ value }: { value?: string | null }) {
  if (!value) return <span className="t-faint">—</span>;
  return <Badge tone={riskTone(value)} dot>{value}</Badge>;
}

export function Avatar({ name, size, tone, src }: { name: string; size?: 'xs' | 'sm' | 'lg' | 'xl'; tone?: string; src?: string | null }) {
  const cls = cx('avatar', size && `avatar--${size}`, tone ?? toneFor(name));
  if (src) return <img className={cls} src={src} alt="" style={{ objectFit: 'cover' }} />;
  return <span className={cls} aria-hidden="true">{fmt.initials(name)}</span>;
}

export function Person({ name, meta, size = 'sm', tone, to, onClick }: { name: string; meta?: ReactNode; size?: 'xs' | 'sm' | 'lg'; tone?: string; to?: string; onClick?: () => void }) {
  const body = (
    <>
      <Avatar name={name} size={size} tone={tone} />
      <span className="col" style={{ minWidth: 0 }}>
        <span className="person__name t-clip">{name}</span>
        {meta ? <span className="person__meta t-clip">{meta}</span> : null}
      </span>
    </>
  );
  if (to) return <Link className="person person--link" to={to} onClick={(e) => e.stopPropagation()}>{body}</Link>;
  if (onClick) return <button type="button" className="person person--link" onClick={(e) => { e.stopPropagation(); onClick(); }}>{body}</button>;
  return <span className="person">{body}</span>;
}

/** Universal rule from the wireframe: a student is always clickable and always opens Student 360. */
export function StudentLink({ id, name, meta }: { id: string; name: string; meta?: ReactNode }) {
  return <Person name={name} meta={meta} to={`/student-360/${id}`} />;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'ghost' | 'amber' | 'teal' | 'danger' | 'quiet' | 'gold' | 'onnavy';

export interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: Variant;
  size?: 'sm' | 'lg';
  icon?: string;
  iconRight?: string;
  block?: boolean;
  to?: string;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'ghost', size, icon, iconRight, block, to, loading, children, className, onClick, disabled, type = 'button', ...rest },
  ref,
) {
  const navigate = useNavigate();
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', icon && !children && 'btn--icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e) => {
        onClick?.(e);
        if (to && !e.defaultPrevented) navigate(to);
      }}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 13 : 15} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
      {iconRight && <Icon name={iconRight} size={15} />}
    </button>
  );
});

export function IconButton({ icon, label, onClick, to, count, className, size = 18, title, ...rest }: { icon: string; label: string; onClick?: () => void; to?: string; count?: number | string; className?: string; size?: number; title?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={cx('iconbtn', className)}
      aria-label={label}
      title={title ?? label}
      onClick={() => {
        onClick?.();
        if (to) navigate(to);
      }}
      {...rest}
    >
      <Icon name={icon} size={size} />
      {count ? <span className="iconbtn__dot">{count}</span> : null}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'hs-spin .8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
export function Card({ title, sub, actions, children, foot, className, flush, tight, id, icon }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; foot?: ReactNode;
  className?: string; flush?: boolean; tight?: boolean; id?: string;
  /** Brand-coloured icon shown before the title. */
  icon?: string;
}) {
  return (
    <section className={cx('card', className)} id={id}>
      {(title || actions) && (
        <div className="card__head">
          {icon && <span className="card__ico"><Icon name={icon} size={20} /></span>}
          <div className="grow" style={{ minWidth: 0 }}>
            {title && <div className="card__title">{title}</div>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {actions && <div className="row g-2 none">{actions}</div>}
        </div>
      )}
      <div className={flush ? undefined : cx('card__body', tight && 'card__body--tight')}>{children}</div>
      {foot && <div className="card__foot">{foot}</div>}
    </section>
  );
}

/** Small "View all" style link for card headers. */
export function CardLink({ to, children = 'View all' }: { to: string; children?: ReactNode }) {
  return <Link className="cardlink" to={to}>{children}</Link>;
}

export function Kpi({ label, value, unit, delta, deltaUnit = '%', inverse, foot, spark, sparkColor, tone, to, onClick, loading, icon, size }: {
  label: string; value: ReactNode; unit?: string; delta?: number | null; deltaUnit?: string; inverse?: boolean;
  foot?: ReactNode; spark?: number[]; sparkColor?: string; tone?: 'amber' | 'teal' | 'critical' | 'info' | 'violet'; to?: string; onClick?: () => void; loading?: boolean;
  /** Optional icon tile in the tone colour. */
  icon?: string;
  /** hero: headline figure; compact: secondary figure in a dense grid. */
  size?: 'hero' | 'compact';
}) {
  const navigate = useNavigate();
  const link = !!(to || onClick);
  const up = (delta ?? 0) >= 0;
  const good = inverse ? !up : up;
  const content = (
    <>
      {icon && size !== 'compact' && <span className="kpi__tile"><Icon name={icon} size={20} /></span>}
      <div className="kpi__top">
        <div className="kpi__label">{label}</div>
        {icon && size === 'compact' ? <span className="kpi__ico"><Icon name={icon} size={14} /></span> : link ? <Icon name="arrowRight" size={14} className="kpi__go" /> : null}
      </div>
      <div className="kpi__value">
        {loading ? <span className="skeleton" style={{ display: 'inline-block', width: 72, height: 26 }} /> : value}
        {unit && <small> {unit}</small>}
      </div>
      {(foot || delta != null) && (
        <div className="kpi__foot">
          {delta != null && (
            <span className={`kpi__delta kpi__delta--${good ? 'up' : 'down'}`}>
              <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} />
              {Math.abs(delta)}{deltaUnit}
            </span>
          )}
          {foot && <span>{foot}</span>}
        </div>
      )}
      {spark && spark.length > 1 && <span className="kpi__spark"><Svg html={charts.spark(spark, { color: sparkColor ?? 'var(--teal)' })} /></span>}
    </>
  );
  const cls = cx('kpi', tone && `kpi--${tone}`, size && `kpi--${size}`, link && 'kpi--link');
  if (link) {
    return (
      <button type="button" className={cls} style={{ textAlign: 'left', width: '100%' }} onClick={() => (onClick ? onClick() : navigate(to!))}>
        {content}
      </button>
    );
  }
  return <div className={cls} style={{ textAlign: 'left', width: '100%' }}>{content}</div>;
}

export function Meter({ label, value, right, tone, hint, lg }: { label: ReactNode; value: number; right?: ReactNode; tone?: 'teal' | 'critical' | string; hint?: ReactNode; lg?: boolean }) {
  return (
    <div className="meter">
      <div className="meter__top">
        <span className="t-muted t-clip">{label}</span>
        <span className="t-bold t-num none">{right ?? `${Math.round(value)}%`}</span>
      </div>
      <div className={cx('bar', lg && 'bar--lg')}>
        <div className={cx('bar__fill', tone && `bar__fill--${tone}`)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      {hint && <div className="t-micro t-muted">{hint}</div>}
    </div>
  );
}

export function Dl({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ title, sub, icon = 'search', action }: { title: string; sub?: ReactNode; icon?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art"><LotusArt /><span className="empty__badge"><Icon name={icon} size={13} /></span></div>
      <div className="h3">{title}</div>
      {sub && <p className="t-sm t-muted mt-2">{sub}</p>}
      {action && <div className="row center mt-4">{action}</div>}
    </div>
  );
}

export function Banner({ children, tone, icon = 'info' }: { children: ReactNode; tone?: 'critical' | 'warning' | 'success' | 'neutral'; icon?: string }) {
  return (
    <div className={cx('banner', tone && `banner--${tone}`)} role={tone === 'critical' ? 'alert' : undefined}>
      <Icon name={icon} size={17} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function AiNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="ai-advisory">
      <Icon name="info" size={13} />
      <span>
        {children ?? (
          <>
            <strong>Advisory only.</strong> AI output is a suggestion. An authorised teacher or manager must review and approve before anything is published or acted on.
          </>
        )}
      </span>
    </div>
  );
}

export function SectionHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="grow">
        <div className="section-head__title">{title}</div>
        {sub && <div className="section-head__sub">{sub}</div>}
      </div>
      {right && <div className="row g-2 none">{right}</div>}
    </div>
  );
}

export interface Crumb { label: string; to?: string }

/** Breadcrumb trail derived from the sidebar: "Section › Page", plus the record for detail routes. */
function useAutoCrumbs(title: ReactNode): Crumb[] | undefined {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const meta = routeMeta(pathname);
  if (!meta || (meta.group === 'Overview' && !meta.nested)) return undefined;
  const trail: Crumb[] = [{ label: t(meta.group) }];
  if (meta.nested) {
    trail.push({ label: t(meta.label), to: meta.to });
    if (typeof title === 'string') trail.push({ label: title });
  } else {
    trail.push({ label: t(meta.label) });
  }
  return trail;
}

export function PageHead({ title, sub, crumbs, actions }: { title: ReactNode; sub?: ReactNode; crumbs?: Crumb[] | false; actions?: ReactNode }) {
  const auto = useAutoCrumbs(title);
  const trail = crumbs === false ? undefined : crumbs ?? auto;
  const meta = routeMeta(useLocation().pathname);
  return (
    <div className="pagehead">
      {meta && <span className="pagehead__ico" data-hue={meta.hue} aria-hidden="true"><Icon name={meta.icon} size={20} /></span>}
      <div className="grow" style={{ minWidth: 0 }}>
        {trail && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {trail.map((c, i) => (
              <span key={i} className="row g-1" style={{ display: 'inline-flex' }}>
                {i > 0 && <Icon name="chevronRight" size={12} />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="pagehead__title">{title}</h1>
        <LotusDivider className="pagehead__divider" />
        {sub && <p className="pagehead__sub">{sub}</p>}
      </div>
      {actions && <div className="pagehead__actions">{actions}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('page', className)}>{children}</div>;
}

export function Grid({ cols, children, className, style }: { cols: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={cx('grid', cols, className)} style={style}>{children}</div>;
}

export function Illustrative({ children = 'Sample data' }: { children?: ReactNode }) {
  return (
    <span className="illustrative">
      <Icon name="info" size={12} />
      {children}
    </span>
  );
}

export function StatStrip({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="statstrip">
      {items.map((it) => (
        <div className="statstrip__item" key={it.label}>
          <div className="statstrip__label">{it.label}</div>
          <div className="statstrip__value">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selection controls
// ---------------------------------------------------------------------------
export interface Opt<T extends string = string> { id: T; label: ReactNode; count?: number; tone?: string }

export function Tabs<T extends string>({ items, active, onChange, pills }: { items: Opt<T>[]; active: T; onChange: (id: T) => void; pills?: boolean }) {
  return (
    <div className={cx('tabs', pills && 'tabs--pills')} role="tablist">
      {items.map((t) => (
        <button key={t.id} type="button" className="tabs__item" role="tab" aria-selected={t.id === active} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && <span className="tag tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segment<T extends string>({ items, active, onChange }: { items: Opt<T>[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="segment" role="group">
      {items.map((s) => (
        <button key={s.id} type="button" aria-pressed={s.id === active} onClick={() => onChange(s.id)}>{s.label}</button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ items, active, onChange }: { items: Opt<T>[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="row g-2 wrap">
      {items.map((s) => (
        <button key={s.id} type="button" className="chip" aria-pressed={s.id === active} onClick={() => onChange(s.id)}>
          {s.tone && <span className={`dot dot--${s.tone}`} />}
          {s.label}
          {s.count != null && <span className="t-bold"> {s.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="row g-2" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span className="switch__track" />
      </span>
      <span className="t-sm">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
interface FieldShell { label?: ReactNode; hint?: ReactNode; error?: string; required?: boolean; className?: string; style?: CSSProperties }

function Shell({ label, hint, error, required, className, style, children, htmlFor }: FieldShell & { children: ReactNode; htmlFor: string }) {
  return (
    <div className={cx('field', className)} style={style}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="req"> *</span>}
        </label>
      )}
      {children}
      {error ? <span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextField({ label, hint, error, required, className, style, value, onChange, type = 'text', ...rest }: FieldShell & {
  value: string | number | undefined | null; onChange: (v: string) => void; type?: string; placeholder?: string; min?: string | number; max?: string | number;
  step?: string | number; maxLength?: number; autoComplete?: string; disabled?: boolean; name?: string; pattern?: string; autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Shell {...{ label, hint, error, required, className, style }} htmlFor={id}>
      <input
        id={id}
        className="input"
        type={type}
        value={value ?? ''}
        required={required}
        aria-invalid={!!error || undefined}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Shell>
  );
}

export function TextArea({ label, hint, error, required, className, style, value, onChange, rows = 4, ...rest }: FieldShell & {
  value: string | undefined | null; onChange: (v: string) => void; rows?: number; placeholder?: string; maxLength?: number; disabled?: boolean; autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Shell {...{ label, hint, error, required, className, style }} htmlFor={id}>
      <textarea id={id} className="textarea" rows={rows} value={value ?? ''} required={required} aria-invalid={!!error || undefined}
        style={{ height: 'auto', padding: '8px 12px' }}
        onChange={(e) => onChange(e.target.value)} {...rest} />
    </Shell>
  );
}

export interface SelectOption { value: string; label: string }

export function SelectField({ label, hint, error, required, className, style, value, onChange, options, placeholder, disabled }: FieldShell & {
  value: string | undefined | null; onChange: (v: string) => void; options: (SelectOption | string)[]; placeholder?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <Shell {...{ label, hint, error, required, className, style }} htmlFor={id}>
      <select id={id} className="select" value={value ?? ''} required={required} disabled={disabled} aria-invalid={!!error || undefined}
        onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value}>{opt.label}</option>;
        })}
      </select>
    </Shell>
  );
}

/** Compact select used in filter bars (no label row). */
export function FilterSelect({ value, onChange, options, label, allLabel = 'All', style }: {
  value: string; onChange: (v: string) => void; options: (SelectOption | string)[]; label: string; allLabel?: string | null; style?: CSSProperties;
}) {
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto', minWidth: 130, ...style }}>
      {allLabel !== null && <option value="">{label}: {allLabel}</option>}
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
      })}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Search box with a short debounce; calls onSearch with the trimmed term. */
export function SearchInput({ value, onSearch, placeholder = 'Search…', maxWidth = 320, delay = 250 }: { value: string; onSearch: (q: string) => void; placeholder?: string; maxWidth?: number; delay?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onSearch(text.trim()), delay);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="input-icon grow" style={{ maxWidth }}>
      <Icon name="search" size={15} />
      <input className="input" type="search" placeholder={placeholder} aria-label={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists & flows
// ---------------------------------------------------------------------------
export interface TimelineItem { time: ReactNode; title: ReactNode; body?: ReactNode; tone?: 'teal' | 'amber' | 'critical' | 'muted' | 'neutral' | string }

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="timeline">
      {items.map((i, idx) => (
        <div className="timeline__item" key={idx}>
          <span className={cx('timeline__dot', i.tone && i.tone !== 'neutral' && `timeline__dot--${i.tone}`)} />
          <div className="timeline__time">{i.time}</div>
          <div className="timeline__title">{i.title}</div>
          {i.body && <div className="timeline__body">{i.body}</div>}
        </div>
      ))}
    </div>
  );
}

export interface FeedItem { time: ReactNode; text: ReactNode; meta?: ReactNode; icon?: string; badge?: ReactNode }

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <div>
      {items.map((i, idx) => (
        <div className="feed__item" key={idx}>
          <span className="feed__time">{i.time}</span>
          <span className="none" style={{ paddingTop: 1 }}><Icon name={i.icon ?? 'activity'} size={15} className="t-muted" /></span>
          <div className="grow">
            <div className="t-sm">{i.text}</div>
            {i.meta && <div className="t-micro t-muted">{i.meta}</div>}
          </div>
          {i.badge && <span className="none">{i.badge}</span>}
        </div>
      ))}
    </div>
  );
}

export function AlertItem({ tone, icon = 'alertCircle', title, meta, to, onClick, right }: { tone: string; icon?: string; title: ReactNode; meta?: ReactNode; to?: string; onClick?: () => void; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <button type="button" className={`alert-item alert-item--${tone}`} onClick={() => (onClick ? onClick() : to && navigate(to))}>
      <span className={`alert-item__ico alert-item__ico--${tone}`}><Icon name={icon} size={16} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="alert-item__title" style={{ display: 'block' }}>{title}</span>
        {meta && <span className="alert-item__meta" style={{ display: 'block' }}>{meta}</span>}
      </span>
      {right ? <span className="none row g-2">{right}</span> : <Icon name="chevronRight" size={15} className="t-faint" />}
    </button>
  );
}

export function Flow({ steps }: { steps: { label: ReactNode; meta?: ReactNode; state?: 'done' | 'active' }[] }) {
  return (
    <div className="flow">
      {steps.map((s, i) => (
        <div key={i} className={cx('flow__step', s.state && `flow__step--${s.state}`)}>
          <span className="flow__label">{s.label}</span>
          {s.meta && <span className="flow__meta">{s.meta}</span>}
        </div>
      ))}
    </div>
  );
}

export function Stepper({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => {
        const state = i < active ? 'done' : i === active ? 'active' : '';
        return (
          <span key={s} style={{ display: 'contents' }}>
            {i > 0 && <span className="stepper__line" />}
            <span className={cx('stepper__node', state && `stepper__node--${state}`)}>
              <span className="stepper__num">{i < active ? <Icon name="check" size={12} /> : i + 1}</span>
              {s}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function Funnel({ rows, onSelect }: { rows: { label: string; value: number; color?: string }[]; onSelect?: (label: string) => void }) {
  const top = rows[0]?.value || 1;
  const SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)'];
  return (
    <div className="funnel">
      {rows.map((r, i) => {
        const conv = i && rows[i - 1].value ? Math.round((r.value / rows[i - 1].value) * 100) : 100;
        return (
          <button type="button" className="funnel__row" key={r.label} onClick={() => onSelect?.(r.label)}>
            <span className="funnel__label">{r.label}</span>
            <span className="funnel__track">
              <span className="funnel__bar" style={{ width: `${Math.max(10, (r.value / top) * 100)}%`, background: r.color ?? SERIES[i % 8] }}><span className="funnel__val">{fmt.n(r.value)}</span></span>
            </span>
            <span className="funnel__conv">{i ? `${conv}%` : ' '}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Ring({ pct, size = 52, color, text }: { pct: number; size?: number; color?: string; text?: string }) {
  return <Svg html={charts.ring(Math.round(pct), { size, color, text })} />;
}
