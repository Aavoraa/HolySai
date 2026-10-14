import { lazy, type ComponentType } from 'react';

/**
 * A lazy-loaded page that can also be fetched ahead of time: `preload()` starts
 * downloading its code (for example when the pointer rests on a menu link), so
 * opening the page then feels instant. The download happens once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function page<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | null = null;
  const get = () => (pending ??= load());
  return Object.assign(lazy(get), { preload: get });
}
