import type { ReactNode } from 'react';
import { Icon } from './primitives';
import { LotusDivider, LotusMark } from './LotusArt';

/** The campus photo behind the sign-in screen. Replace this file to change it. */
export const CAMPUS_PHOTO = '/images/campus-hero.webp';
/** The wider campus view on dashboard banners. */
const BANNER_PHOTO = '/images/campus-banner.webp?v=4';
const PHOTO_W = 1800;
const PHOTO_H = 464;

const today = () =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());

/** Time-of-day greeting in school time (IST). */
export function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
}

/** A few drifting rose petals for the welcome banner (decorative). */
const PETALS: [number, number, number, number][] = [[2, 78, 16, -30], [31, 12, 11, 40], [38, 88, 9, 120], [55, 8, 12, -60], [83, 22, 13, 25], [95, 70, 10, 150]];
function Petals() {
  return (
    <svg className="campusbanner__petals" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {PETALS.map(([x, y, s, r]) => (
        <path key={`${x}-${y}`} d="M0 -1 C 0.9 -0.9 1 0.2 0 1 C -1 0.2 -0.9 -0.9 0 -1 Z"
          transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 20} ${s / 10})`} />
      ))}
    </svg>
  );
}

/**
 * Dashboard welcome: greeting, summary, date and actions on the left (with a
 * gold accent line); the campus photo fades in on the right with the school's
 * line "Nurturing young minds for a brighter tomorrow".
 */
export function CampusBanner({ title, sub, actions, children, welcome = false, date = true, bleed = true, quote = welcome }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; date?: boolean;
  /** A personal greeting: blush banner with petals, larger serif title. */
  welcome?: boolean;
  /** Kept for existing callers; the banner always sits inside the page gutter. */
  bleed?: boolean;
  /** The school's inspirational line over the photo; by default only on greetings, where the text leaves room for it. */
  quote?: boolean;
}) {
  return (
    <section className={`campusbanner${bleed ? ' campusbanner--bleed' : ''}${welcome ? ' campusbanner--welcome' : ''}`} aria-label="Welcome">
      <figure className="campusbanner__photo">
        <img src={BANNER_PHOTO} alt="Holy Sai International School campus" width={PHOTO_W} height={PHOTO_H} />
      </figure>
      <LotusMark className="campusbanner__lotus" />
      {welcome && <Petals />}
      <div className="campusbanner__body">
        <div className="campusbanner__text">
          <h1 className="campusbanner__title">{title}</h1>
          {sub && <p className="campusbanner__sub">{sub}</p>}
          {date && <span className="campusbanner__date"><Icon name="calendar" size={15} />{today()}</span>}
          {children}
          {actions && <div className="campusbanner__actions">{actions}</div>}
        </div>
        {quote && <p className="campusbanner__quote">“Nurturing young minds<br />for a brighter tomorrow”<LotusDivider /></p>}
      </div>
    </section>
  );
}
