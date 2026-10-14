import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'hs.theme';
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function current(): Theme {
  const v = document.documentElement.getAttribute('data-theme');
  return v === 'dark' ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  listeners.forEach((l) => l());
}

/**
 * The application uses the light theme only (the dark theme is switched off).
 * A dark choice saved by an earlier version is cleared.
 */
export function initTheme() {
  try { if (stored() === 'dark') localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  apply('light');
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme);
  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    apply(t);
  }, []);
  const toggle = useCallback(() => setTheme(current() === 'dark' ? 'light' : 'dark'), [setTheme]);
  return { theme, setTheme, toggle };
}
