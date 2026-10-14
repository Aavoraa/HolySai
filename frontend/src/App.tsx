import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { AppShell, Protected } from '@/layouts/AppShell';
import { SchoolContextProvider } from '@/layouts/SchoolContext';
import { LotusArt, PageSkeleton } from '@/components/ui';
import { APP_ROUTES } from '@/pages/registry';
import LoginPage from '@/pages/core/LoginPage';
import NotFoundPage from '@/pages/core/NotFoundPage';

const UiLab = import.meta.env.DEV ? lazy(() => import('@/dev/UiLab')) : null;

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }} aria-busy="true">
      <div className="col center g-3">
        <LotusArt className="splash__lotus" />
        <span className="t-sm t-muted">Opening Holy Sai Smart School 360…</span>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role.homeRoute ?? '/login'} replace />;
}

export default function App() {
  const { status } = useAuth();
  return (
    <Routes>
      {UiLab && <Route path="/__ui" element={<Suspense fallback={<Splash />}><UiLab /></Suspense>} />}
      <Route path="/login" element={status === 'loading' ? <Splash /> : status === 'authenticated' ? <HomeRedirect /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <SchoolContextProvider>
              <AppShell />
            </SchoolContextProvider>
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        {APP_ROUTES.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <Protected perm={r.perm}>
                <Suspense fallback={<div className="page"><PageSkeleton /></div>}>{r.element}</Suspense>
              </Protected>
            }
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
