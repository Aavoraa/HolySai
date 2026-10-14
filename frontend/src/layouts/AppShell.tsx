import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { preloadRoute } from '@/pages/registry';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { Avatar, Badge, Button, Dropdown, Empty, Icon, Lotus, Modal, useConfirm, useToast, LotusMark } from '@/components/ui';
import { NAV, mobileNavFor, type NavItem } from './nav';
import { routeMeta } from './routeMeta';
import { useSchool } from './SchoolContext';
import { fmt } from '@/lib/format';

interface Counts { unread: number; alerts: number; openTasks: number }

function pathOf(to: string) {
  return to.split('?')[0];
}

const SECTION_ORDER = ['Student Management', 'Admissions', 'Finance', 'HR & Workforce', 'Transport & Safety', 'Operations', 'Insights & Innovation', 'Administration'];
function sectionRank(section: string, pinned: boolean) {
  if (pinned) return -1;
  const i = SECTION_ORDER.indexOf(section);
  return i < 0 ? SECTION_ORDER.length : i;
}

/** Groups and items this user may see; Overview de-duplicated against the home route. */
function useNavModel() {
  const { user, can } = useAuth();
  return useMemo(() => {
    if (!user) return [];
    const home = user.role.homeRoute;
    return NAV.map((g) => {
      let items = g.items.filter((i) => can(i.perm ?? null)
        && (!i.roles || i.roles.includes(user.role.key))
        && !i.hideRoles?.includes(user.role.key));
      if (g.group === 'Overview') items = items.filter((i) => i.dynamicHome || pathOf(i.to) !== home);
      // A page listed twice in one group only appears once
      const seen = new Set<string>();
      items = items.filter((i) => (seen.has(i.to) ? false : (seen.add(i.to), true)));
      // Direct links shown under the group (only pages this user may open).
      const quick = (g.quick ?? []).flatMap((q) => {
        const it = items.find((i) => pathOf(i.to) === q.to);
        return it ? [{ ...it, label: q.label ?? it.label }] : [];
      });
      return { group: g.group, label: g.label ?? g.group, hue: g.hue ?? 'brand', icon: g.icon, section: g.section ?? '', items, quick, pinned: g.group === 'Overview' };
    }).filter((g) => g.items.length)
      // Groups that share a sidebar caption sit together, in caption order.
      .map((g, i) => ({ g, i }))
      .sort((a, b) => sectionRank(a.g.section, a.g.pinned) - sectionRank(b.g.section, b.g.pinned) || a.i - b.i)
      .map(({ g }) => g);
  }, [user, can]);
}

export function AppShell() {
  const [rail, setRail] = useState(() => localStorage.getItem('hs.rail') === '1');
  const [drawer, setDrawer] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setDrawer(false);
    setMobileSearch(false);
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  // Browser tab title follows the page, so tabs and history stay distinguishable.
  const { t } = useI18n();
  useEffect(() => {
    const meta = routeMeta(location.pathname);
    const extra: Record<string, string> = { '/account': 'My account', '/help': 'Help' };
    const name = meta ? t(meta.label) : extra[location.pathname];
    document.title = name ? `${name} · Holy Sai Smart School 360` : 'Holy Sai Smart School 360';
  }, [location.pathname, t]);

  useEffect(() => {
    try {
      localStorage.setItem('hs.rail', rail ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [rail]);

  const counts = useApiQuery<Counts>('/notifications/counts', undefined, { refetchInterval: 60_000 });

  return (
    <div className="app" data-rail={String(rail)} data-drawer={String(drawer)} data-search={String(mobileSearch)}>
      <a href="#main" className="skiplink">Skip to main content</a>
      <button className="sidebar__scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setDrawer(false)} />
      <aside className="sidebar" id="sidebar" aria-label="Main menu">
        <Sidebar rail={rail} onToggleRail={() => setRail((r) => !r)} onExpand={() => setRail(false)} counts={counts.data} />
      </aside>
      <div className="main">
        <header className="topbar" id="topbar">
          <Topbar
            onMenu={() => setDrawer((d) => !d)}
            mobileSearch={mobileSearch}
            onToggleSearch={() => setMobileSearch((s) => !s)}
            alertCount={counts.data?.alerts ?? 0}
          />
        </header>
        <main className="view" id="main" ref={mainRef} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <MobileNav onDrawer={() => setDrawer((d) => !d)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function Sidebar({ rail, onToggleRail, onExpand, counts }: { rail: boolean; onToggleRail: () => void; onExpand: () => void; counts?: Counts }) {
  const model = useNavModel();
  const { user, logout, can } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const listRef = useRef<HTMLElement>(null);

  const current = location.pathname;
  const routeOf = (i: NavItem) => pathOf(i.dynamicHome ? user!.role.homeRoute : i.to);
  const matches = (i: NavItem) => {
    const r = routeOf(i);
    return current === r || current.startsWith(r + '/');
  };

  // Exactly one section owns the current page: Overview first, then the first section listing it.
  const owner = useMemo(() => {
    for (const g of model) if (g.items.some(matches)) return g.pinned ? '__pinned__' : g.group;
    return null;
  }, [model, current]); // eslint-disable-line react-hooks/exhaustive-deps
  // A page with its own direct link is highlighted there, and its group stays closed.
  const quickHit = useMemo(() => model.some((g) => g.quick.some(matches)), [model, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the page: open the section that owns it when the route changes.
  useEffect(() => {
    setOpen(owner === '__pinned__' || quickHit ? null : owner);
  }, [owner, quickHit]);

  // Bring the current page's item into view — only after navigating, never when a
  // section is merely expanded or collapsed (that used to jump the menu to the top).
  const followRoute = useRef(true);
  useEffect(() => { followRoute.current = true; }, [current]);
  useEffect(() => {
    if (!followRoute.current) return;
    const el = listRef.current?.querySelector<HTMLElement>('.navitem[aria-current="page"]');
    const list = listRef.current;
    if (el && list && el.offsetParent) {
      followRoute.current = false;
      const y = el.offsetTop - list.offsetTop;
      if (y < list.scrollTop || y + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, y - list.clientHeight / 3);
    }
  }, [current, open]);

  // Keep a clicked section header at the same place on screen, even when the
  // section above it collapses as this one opens.
  const anchor = useRef<{ group: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    const list = listRef.current;
    anchor.current = null;
    if (!a || !list) return;
    const head = list.querySelector<HTMLElement>(`.navhead[data-group="${CSS.escape(a.group)}"]`);
    if (head) list.scrollTop += head.getBoundingClientRect().top - a.top;
  }, [open]);

  const ql = q.trim().toLowerCase();
  let matchCount = 0;

  const badgeFor = (i: NavItem) => (i.badge === 'alerts' ? counts?.alerts : i.badge === 'tasks' ? counts?.openTasks : undefined);

  const itemEl = (i: NavItem, owns: boolean) => {
    const target = i.dynamicHome ? user!.role.homeRoute : i.to;
    const label = t(i.label);
    const at = ql ? label.toLowerCase().indexOf(ql) : -1;
    const count = badgeFor(i);
    return (
      <Link key={i.label + i.to} className="navitem" to={target} aria-current={owns && matches(i) ? 'page' : undefined} title={label} onClick={() => setQ('')}
        onMouseEnter={() => preloadRoute(target)} onFocus={() => preloadRoute(target)}>
        <span className="navitem__ico"><Icon name={i.icon} size={17} /></span>
        <span className="navitem__label">
          {at > -1 ? (
            <>
              {label.slice(0, at)}
              <mark className="navmark">{label.slice(at, at + ql.length)}</mark>
              {label.slice(at + ql.length)}
            </>
          ) : label}
        </span>
        {count ? <span className={`navitem__count${i.tone ? ` navitem__count--${i.tone}` : ''}`}>{count}</span> : null}
      </Link>
    );
  };

  const signOut = async () => {
    setProfileAnchor(null);
    const ok = await confirm({
      title: `${t('Sign out')}?`,
      body: (
        <div className="row-top g-4">
          <span className="none"><Avatar name={user!.fullName} size="lg" tone="avatar--amber" /></span>
          <div className="grow">
            <p className="t-sm">You are signed in as <strong>{user!.fullName}</strong>, {user!.title}.</p>
            <p className="t-sm t-muted mt-2">Signing out ends this session on this device and returns you to the sign-in screen.</p>
          </div>
        </div>
      ),
      confirmLabel: t('Sign out'),
      danger: true,
      icon: 'logout',
    });
    if (!ok) return;
    await logout();
    toast(`${t('Sign out')} — session ended`, 'success', 'logout');
    navigate('/login', { replace: true });
  };

  return (
    <>
      <div className="sidebar__brand">
        <Link to={user!.role.homeRoute} className="sidebar__logo" aria-label="Holy Sai Smart School 360 — home">
          <span className="sidebar__mark"><Lotus size={32} /></span>
          <span className="col grow" style={{ minWidth: 0 }}>
            <span className="sidebar__name">Holy Sai</span>
            <span className="sidebar__tag">Smart School 360</span>
          </span>
        </Link>
        <button className="iconbtn none sidebar__railbtn" onClick={onToggleRail} aria-label={rail ? 'Expand navigation' : 'Collapse navigation'} title={rail ? 'Expand navigation' : 'Collapse navigation'}>
          <Icon name="chevronsLeft" size={15} />
        </button>
      </div>
      <LotusMark className="sidebar__lotus" />
      <nav className="sidebar__scroll" aria-label="Main navigation" ref={listRef}>
        {model.map((g) => {
          let items = g.items;
          if (ql) {
            const groupHit = t(g.label).toLowerCase().includes(ql);
            if (!groupHit) items = items.filter((i) => t(i.label).toLowerCase().includes(ql));
            if (!items.length) return null;
            matchCount += items.length;
          }
          const owns = g.pinned ? owner === '__pinned__' : owner === g.group && !quickHit;
          const list = <div className="navgroup__items">{items.map((i) => itemEl(i, owns))}</div>;
          if (g.pinned) return <div className="navgroup navgroup--pinned" data-open="true" key={g.group} data-hue="brand">{list}</div>;
          const isOpen = ql ? true : open === g.group;
          const idx = model.indexOf(g);
          const newSection = !!g.section && model[idx - 1]?.section !== g.section;
          return (
            <div className="navgroup" data-open={String(isOpen)} data-current={owns ? 'true' : undefined} key={g.group} data-hue={g.hue}>
              {newSection && !ql && <div className="navsection" aria-hidden="true">{t(g.section)}</div>}
              <button
                className="navhead"
                data-group={g.group}
                aria-expanded={isOpen}
                title={t(g.label)}
                onClick={(e) => {
                  followRoute.current = false;
                  anchor.current = { group: g.group, top: e.currentTarget.getBoundingClientRect().top };
                  if (rail) {
                    onExpand();
                    setOpen(g.group);
                  } else setOpen(open === g.group ? null : g.group);
                }}
              >
                <span className="navhead__ico"><Icon name={g.icon} size={17} /></span>
                <span className="navhead__label">{t(g.label)}</span>
                {owns && !isOpen && <span className="navhead__dot" aria-label="Current section" />}
                <span className="navhead__chev"><Icon name="chevronDown" size={14} /></span>
              </button>
              {list}
              {!ql && g.quick.length > 0 && (
                <div className="navquick">{g.quick.map((i) => itemEl(i, true))}</div>
              )}
            </div>
          );
        })}
        {ql && !matchCount && (
          <div className="navempty">
            <Icon name="search" size={18} />
            <div>No page matches “{q}”</div>
            <button className="navempty__btn" onClick={() => setQ('')}>Clear search</button>
          </div>
        )}
      </nav>
      <div className="sidebar__foot">
        <div className="sidebar__footrow">
          <Link
            className="navitem grow"
            to={can('settings.manage') ? '/admin/settings' : '/account?tab=security'}
            aria-current={current === '/admin/settings' || current === '/account' ? 'page' : undefined}
            title={t('Settings')}
          >
            <span className="navitem__ico"><Icon name="settings" size={18} /></span>
            <span className="navitem__label">{t('Settings')}</span>
          </Link>
          <button className="iconbtn iconbtn--onnavy none sidebar__logout" aria-label={t('Sign out')} title={t('Sign out')} onClick={signOut}>
            <Icon name="logout" size={14} />
          </button>
        </div>
      </div>
      <ProfileMenu anchor={profileAnchor} onClose={() => setProfileAnchor(null)} onSignOut={signOut} />
    </>
  );
}

function ProfileMenu({ anchor, onClose, onSignOut, onLanguage }: { anchor: HTMLElement | null; onClose: () => void; onSignOut: () => void; onLanguage?: () => void }) {
  const { user, can } = useAuth();
  const { t, short } = useI18n();
  const navigate = useNavigate();
  if (!user) return null;
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <Dropdown anchor={anchor} open={!!anchor} onClose={onClose} label="Profile menu">
      <div className="menu__head">
        <Avatar name={user.fullName} size="lg" tone="avatar--amber" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="t-sm t-bold t-clip">{user.fullName}</div>
          <div className="menu__meta t-clip">{user.title}</div>
          <div className="menu__meta t-clip">{user.email}</div>
          <div className="mt-2"><Badge tone="info">{user.role.name}</Badge></div>
        </div>
      </div>
      <div className="menu__body">
        <button className="menu__item" role="menuitem" onClick={() => go('/account')}><Icon name="user" size={16} /><span className="grow">My profile</span></button>
        <button className="menu__item" role="menuitem" onClick={() => go('/account?tab=security')}><Icon name="settings" size={16} /><span className="grow">Account settings</span></button>
        <button className="menu__item" role="menuitem" onClick={() => go('/account?tab=notifications')}><Icon name="bell" size={16} /><span className="grow">Notification preferences</span></button>
        <button className="menu__item" role="menuitem" onClick={() => go('/account?tab=sessions')}><Icon name="shield" size={16} /><span className="grow">Privacy and access</span></button>
        {can('ai.use') && <button className="menu__item" role="menuitem" onClick={() => go('/copilot')}><Icon name="sparkle" size={16} /><span className="grow">{t('AI Assistant')}</span></button>}
        {onLanguage && <button className="menu__item" role="menuitem" onClick={onLanguage}><Icon name="globe" size={16} /><span className="grow">{t('Language')}</span><span className="menu__right">{short}</span></button>}
        <button className="menu__item" role="menuitem" onClick={() => go('/help')}><Icon name="helpCircle" size={16} /><span className="grow">{t('Help')}</span></button>
      </div>
      <div className="menu__sep" />
      <button className="menu__item menu__item--danger" role="menuitem" onClick={onSignOut}><Icon name="logout" size={16} /><span className="grow">{t('Sign out')}</span></button>
    </Dropdown>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
function Topbar({ onMenu, mobileSearch, onToggleSearch, alertCount }: { onMenu: () => void; mobileSearch: boolean; onToggleSearch: () => void; alertCount: number }) {
  const { user, can } = useAuth();
  const { t, langs, lang, setLang, short, label } = useI18n();
  const school = useSchool();
  const toast = useToast();
  const [campusOpen, setCampusOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [langAnchor, setLangAnchor] = useState<HTMLElement | null>(null);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const { lookups } = useLookups();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const confirm = useConfirm();

  const showCampus = can('dashboard.group') || (can('students.read') && !user?.parentId);

  const signOut = async () => {
    setProfileAnchor(null);
    if (await confirm({ title: `${t('Sign out')}?`, body: 'Signing out ends this session on this device.', confirmLabel: t('Sign out'), danger: true, icon: 'logout' })) {
      await logout();
      navigate('/login', { replace: true });
    }
  };

  return (
    <>
      <button className="iconbtn iconbtn--onnavy menubtn hidden" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
      <span className="topbar__brandSm hidden row g-2">
        <Lotus size={28} />
        <span className="topbar__brandname">Holy Sai</span>
      </span>
      <GlobalSearch />
      <div className="spacer" />
      <button className="iconbtn iconbtn--onnavy searchbtn hidden" onClick={onToggleSearch} aria-label={mobileSearch ? 'Close search' : 'Search'}>
        <Icon name={mobileSearch ? 'x' : 'search'} size={19} />
      </button>
      <div className="topbar__ctx">
        <button className="ctxselect" onClick={() => setYearOpen(true)} title={`${t('Academic Year')}: ${school.yearLabel ?? '—'}`}>
          <Icon name="calendar" size={15} />
          <span className="col">
            <span className="ctxselect__label">{t('Academic Year')}</span>
            <span className="ctxselect__value">{school.yearLabel ?? '—'}</span>
          </span>
          <Icon name="chevronDown" size={13} />
        </button>
        {showCampus && (
          <button
            className="ctxselect"
            onClick={() => setCampusOpen(true)}
            title={`${t('Campus')}: ${school.scope === 'group' ? 'All campuses' : school.campus?.name ?? '—'}`}
          >
            <Icon name="mapPin" size={15} />
            <span className="col" style={{ minWidth: 0 }}>
              <span className="ctxselect__label">{t('Campus')}</span>
              <span className="ctxselect__value">{school.scope === 'group' ? 'All campuses' : school.campus?.name ?? '—'}</span>
            </span>
            <Icon name="chevronDown" size={13} />
          </button>
        )}
      </div>
      <div className="topbar__tools">
        <button className="iconbtn iconbtn--onnavy" title={t('Notifications')} aria-label={`${t('Notifications')}${alertCount ? ` (${alertCount} need attention)` : ''}`} onClick={() => navigate('/notifications')}>
          <Icon name="bell" size={18} />
          {alertCount ? <span className="iconbtn__dot">{alertCount > 99 ? '99+' : alertCount}</span> : null}
        </button>
      </div>
      <span className="topbar__sep topbar__hideSm" aria-hidden="true" />
      <button className="topbar__user" aria-haspopup="menu" title={`${user!.fullName} — ${user!.role.name}`} onClick={(e) => setProfileAnchor(e.currentTarget)}>
        <Avatar name={user!.fullName} size="sm" tone="avatar--amber" />
        <span className="col topbar__usertext" style={{ minWidth: 0 }}>
          <span className="topbar__username">{user!.fullName}</span>
          <span className="topbar__userrole">{user!.title?.split('·')[0].trim() || user!.role.name}</span>
        </span>
        <Icon name="chevronDown" size={14} />
      </button>

      <Dropdown anchor={langAnchor} open={!!langAnchor} onClose={() => setLangAnchor(null)} label="Language">
        <div className="menu__label">{t('Language')}</div>
        {langs.map((l) => (
          <button key={l.id} className="menu__item" role="menuitemradio" aria-checked={l.id === lang} onClick={() => {
            setLang(l.id);
            setLangAnchor(null);
            toast(`${l.label}`, 'success', 'globe');
          }}>
            <span className="menu__code">{l.short}</span>
            <span className="grow">{l.label}</span>
            {l.id === lang && <Icon name="check" size={15} />}
          </button>
        ))}
      </Dropdown>
      <ProfileMenu anchor={profileAnchor} onClose={() => setProfileAnchor(null)} onSignOut={signOut} onLanguage={() => { const el = profileAnchor; setProfileAnchor(null); setLangAnchor(el); }} />

      <Modal open={campusOpen} onClose={() => setCampusOpen(false)} title="Campus & scope" sub="Every figure in the application follows this selection." foot={<Button onClick={() => setCampusOpen(false)}>Close</Button>}>
        <div className="col g-3">
          {can('dashboard.group') && (
            <>
              <button className="optioncard" aria-pressed={school.scope === 'group'} onClick={() => { school.setGroup(); setCampusOpen(false); toast('Group view — all campuses', 'success', 'globe'); }}>
                <span className="avatar avatar--teal"><Icon name="globe" size={18} /></span>
                <span className="col grow">
                  <span className="t-sm t-bold">Group view — all campuses</span>
                  <span className="t-xs t-muted">Consolidated figures across {lookups?.campuses.length ?? 0} campuses</span>
                </span>
                {school.scope === 'group' ? <Badge tone="success">Active</Badge> : <Icon name="chevronRight" size={16} />}
              </button>
              <div className="divider" />
            </>
          )}
          {(lookups?.campuses ?? []).map((c) => {
            const on = school.scope === 'campus' && c.id === school.campusId;
            return (
              <button key={c.id} className="optioncard" aria-pressed={on} onClick={() => { school.setCampus(c.id); setCampusOpen(false); toast(`Campus: ${c.name}`, 'success', 'building'); }}>
                <span className={`avatar ${on ? 'avatar--amber' : ''}`}><Icon name="building" size={18} /></span>
                <span className="col grow">
                  <span className="t-sm t-bold">{c.name}</span>
                  <span className="t-xs t-muted">{c.place} · {c.curriculum}</span>
                </span>
                {on ? <Badge tone="success">Active</Badge> : <Icon name="chevronRight" size={16} />}
              </button>
            );
          })}
        </div>
      </Modal>

      <Modal open={yearOpen} onClose={() => setYearOpen(false)} title="Academic year" foot={<Button onClick={() => setYearOpen(false)}>Close</Button>}>
        <div className="col g-2">
          {(lookups?.academicYears ?? []).map((y) => (
            <button key={y.id} className="optioncard" aria-pressed={y.id === school.yearId} onClick={() => { school.setYear(y.id); setYearOpen(false); toast(`Academic year ${y.label}`, 'success', 'calendar'); }}>
              <span className="avatar"><Icon name="calendar" size={17} /></span>
              <span className="col grow">
                <span className="t-sm t-bold">{y.label}</span>
                <span className="t-xs t-muted">{y.isCurrent ? 'Current year — live data' : 'Archived year — read only'} · {fmt.date(y.startsOn)} – {fmt.date(y.endsOn)}</span>
              </span>
              {y.id === school.yearId && <Badge tone="success">Active</Badge>}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

interface SearchHit { group: string; label: string; meta: string; icon: string; route: string }

function GlobalSearch() {
  const { t } = useI18n();
  const nav = useNavModel();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);

  // Ctrl/Cmd+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, []);

  const remote = useApiQuery<SearchHit[]>(term ? '/search' : null, { q: term });
  const hits = useMemo(() => {
    const pages: SearchHit[] = [];
    const seen = new Set<string>();
    for (const g of nav) {
      for (const i of g.items) {
        if (seen.has(i.to)) continue;
        const labelT = t(i.label);
        if (!term ? g.pinned : `${labelT} ${t(g.label)} ${t(g.group)}`.toLowerCase().includes(term.toLowerCase())) {
          seen.add(i.to);
          pages.push({ group: term ? 'Pages' : 'Suggested', label: labelT, meta: t(g.label), icon: i.icon, route: i.to });
        }
      }
    }
    return [...(remote.data ?? []), ...pages.slice(0, term ? 8 : 6)];
  }, [remote.data, nav, term, t]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ('');
    navigate(h.route);
  };

  const groups: Record<string, SearchHit[]> = {};
  hits.forEach((h) => (groups[h.group] ??= []).push(h));
  let idx = -1;

  return (
    <div className="globalsearch" ref={boxRef}>
      <span className="globalsearch__ico"><Icon name="search" size={16} /></span>
      <input
        ref={inputRef}
        className="globalsearch__input"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-label="Global search"
        placeholder={t('Search students, staff, modules…')}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQ(''); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' && hits[active]) go(hits[active]);
        }}
      />
      <span className="globalsearch__kbd">Ctrl K</span>
      {open && (
        <div className="searchpanel" role="listbox" id="global-search-results">
          {term && remote.isLoading && <div className="searchpanel__group">Searching…</div>}
          {!hits.length && term && !remote.isLoading ? (
            <Empty title={`No matches for “${term}”`} sub="Try a student name, an admission number, an employee ID, a lead reference or a module name." />
          ) : (
            Object.entries(groups).map(([g, items]) => (
              <div key={g}>
                <div className="searchpanel__group">{g}</div>
                {items.map((h) => {
                  idx++;
                  const i = idx;
                  return (
                    <button key={g + h.route + h.label} className="searchpanel__item" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                      <span className="none t-muted"><Icon name={h.icon} size={16} /></span>
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="t-sm t-bold t-clip">{h.label}</span>
                        <span className="t-micro t-muted t-clip">{h.meta}</span>
                      </span>
                      <Icon name="arrowRight" size={14} />
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {hits.length > 0 && (
            <div className="searchpanel__foot" aria-hidden="true">
              <span><kbd>↑</kbd><kbd>↓</kbd>to move</span>
              <span><kbd>Enter</kbd>to open</span>
              <span><kbd>Esc</kbd>to close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile bottom navigation
// ---------------------------------------------------------------------------
function MobileNav({ onDrawer }: { onDrawer: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (!user) return null;
  const items = mobileNavFor(user.role.key, user.role.homeRoute);
  return (
    <nav className="mobilenav" id="mobilenav" aria-label="Primary">
      {items.map((i) =>
        i.drawer ? (
          <button key={i.label} className="mobilenav__item" onClick={onDrawer}>
            <Icon name={i.icon} size={20} />
            <span>{t(i.label)}</span>
          </button>
        ) : (
          <NavLink
            key={i.label}
            className="mobilenav__item"
            to={i.to!}
            aria-current={location.pathname + location.search === i.to || (!i.to!.includes('?') && location.pathname === i.to && !location.search.includes('tab=')) ? 'page' : undefined}
          >
            <Icon name={i.icon} size={20} />
            <span>{t(i.label)}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}

export function Protected({ perm, children }: { perm?: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm ?? null)) return <AccessDenied />;
  return <>{children}</>;
}

export function AccessDenied() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="pagehead__title">Not available for this role</h1>
          <p className="pagehead__sub">Signed in as {user?.role.name}. This module is outside that role's access.</p>
        </div>
      </div>
      <section className="card">
        <div className="card__body">
          <div className="banner banner--warning">
            <Icon name="lock" size={17} />
            <div className="grow">
              <strong>Role-based access.</strong> The interface and the API adapt to the signed-in role. {user?.role.name} sees: {user ? roleDescription(user.role.key) : ''}.
            </div>
          </div>
          <div className="row g-3 mt-4 wrap">
            <Button variant="primary" to={user?.role.homeRoute ?? '/'}>Open my dashboard</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function roleDescription(key: string) {
  return ({
    principal: 'full analytics, command centre, approvals and group dashboard',
    teacher: 'attendance, classes, Student 360, academics and the AI Co-Pilot for assigned classes',
    parent: 'their own children only — tracking, safety, academics, fees and communication',
    office: 'admissions, fees, documents, HR records and front-office safety',
    staff: 'their own attendance, shifts, leave and payslips, plus transport and gate duties',
    hr: 'employee records, attendance, leave, CPD and payroll preparation',
    finance: 'fees, payments, concessions, expenses and reconciliation',
    management: 'dashboards, reports and authorised student information',
    student: 'their own profile',
  } as Record<string, string>)[key] ?? 'the modules assigned to the role';
}
