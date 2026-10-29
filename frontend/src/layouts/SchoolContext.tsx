import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useLookups } from '@/hooks/useLookups';
import type { Campus } from '@/api/types';

/**
 * Header context shared by every screen: which campus (or the whole group)
 * and which academic year is selected. Wireframe rule: every figure in the
 * application follows this selection.
 */
interface SchoolCtx {
  campusId: string | undefined;
  campus: Campus | undefined;
  scope: 'campus' | 'group';
  yearId: string | undefined;
  yearLabel: string | undefined;
  isCurrentYear: boolean;
  setCampus: (id: string) => void;
  setGroup: () => void;
  setYear: (id: string) => void;
  /** Params to pass to list/dashboard endpoints. Group view sends no campus filter. */
  campusParam: { campusId?: string };
}

const Ctx = createContext<SchoolCtx | null>(null);
const KEY = 'hs.context';

// campusCode is left here by the sign-in page; it becomes a campusId once the campuses load.
function readStored(): { campusId?: string; campusCode?: string; scope?: 'campus' | 'group'; yearId?: string } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function SchoolContextProvider({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const { lookups } = useLookups();
  const [state, setState] = useState(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode: selection simply isn't remembered */
    }
  }, [state]);

  useEffect(() => {
    if (!state.campusCode || !lookups) return;
    const picked = lookups.campuses.find((c) => c.code === state.campusCode);
    setState(({ campusCode: _, ...s }) => (picked ? { ...s, campusId: picked.id, scope: 'campus' } : s));
  }, [lookups, state.campusCode]);

  const value = useMemo<SchoolCtx>(() => {
    const campuses = lookups?.campuses ?? [];
    const canSwitch = can(['dashboard.group', 'students.read']) && !user?.parentId;
    const campusId = canSwitch ? state.campusId ?? user?.campusId ?? undefined : user?.campusId ?? undefined;
    const scope = canSwitch && state.scope === 'group' && can('dashboard.group') ? 'group' : 'campus';
    const current = lookups?.academicYears.find((y) => y.isCurrent);
    const year = lookups?.academicYears.find((y) => y.id === state.yearId) ?? current;
    return {
      campusId,
      campus: campuses.find((c) => c.id === campusId),
      scope,
      yearId: year?.id,
      yearLabel: year?.label ?? user?.academic_year,
      isCurrentYear: !year || year.isCurrent,
      setCampus: (id) => setState((s) => ({ ...s, campusId: id, scope: 'campus' })),
      setGroup: () => setState((s) => ({ ...s, scope: 'group' })),
      setYear: (id) => setState((s) => ({ ...s, yearId: id })),
      campusParam: scope === 'group' ? {} : { campusId },
    };
  }, [lookups, state, user, can]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSchool() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSchool must be used inside SchoolContextProvider');
  return v;
}
