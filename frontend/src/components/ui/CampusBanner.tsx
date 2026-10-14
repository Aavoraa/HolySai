import type { ReactNode } from 'react';
import { Icon } from './primitives';

/** The campus photo shown on every dashboard and on the sign-in screen. Replace this file to change it. */
export const CAMPUS_PHOTO = '/images/campus-hero.png';
/** Natural size of the photo; it is never shown larger, so it stays sharp. */
const PHOTO_W = 485;
const PHOTO_H = 132;

const today = () =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());

/** Time-of-day greeting in school time (IST). */
export function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Dashboard header: greeting / page title and actions on the left, then the
 * campus photo beside it, shown at its natural size.
 */
export function CampusBanner({ title, sub, actions, children, date = true, bleed = true }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; date?: boolean;
  /** Edge-to-edge under the top bar (default); false gives a rounded card for narrow portal layouts. */
  bleed?: boolean;
}) {
  return (
    <section className={bleed ? 'campusbanner campusbanner--bleed' : 'campusbanner'} aria-label="Welcome">
      <div className="campusbanner__body">
        <div className="campusbanner__text">
          <h1 className="campusbanner__title">{title}</h1>
          {sub && <p className="campusbanner__sub">{sub}</p>}
          {date && <span className="campusbanner__date"><Icon name="calendar" size={13} />{today()}</span>}
          {children}
          {actions && <div className="campusbanner__actions">{actions}</div>}
        </div>
        <figure className="campusbanner__figure">
          <img src={CAMPUS_PHOTO} alt="Holy Sai International School campus" width={PHOTO_W} height={PHOTO_H} />
        </figure>
      </div>
    </section>
  );
}
