import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Button, Card, Empty, Icon } from './primitives';

export function Skeleton({ height = 16, width = '100%', style }: { height?: number | string; width?: number | string; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ display: 'block', height, width, ...style }} />;
}

/** Placeholder layout while a page loads. */
export function PageSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div className="col g-4" aria-busy="true" aria-label="Loading">
      <Skeleton height={28} width={280} />
      <Skeleton height={14} width={420} />
      <div className="grid g-4col mt-4">
        {Array.from({ length: kpis }).map((_, i) => <Skeleton key={i} height={96} style={{ borderRadius: 14 }} />)}
      </div>
      <div className="grid g-main mt-4">
        <Skeleton height={280} style={{ borderRadius: 14 }} />
        <Skeleton height={280} style={{ borderRadius: 14 }} />
      </div>
    </div>
  );
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    // A bare "Validation failed" does not say what to fix; name the fields the API rejected.
    const fields = Array.isArray(err.details) ? err.details.filter((d) => d?.message) : [];
    if (err.code === 'VALIDATION_ERROR' && fields.length) {
      return `${err.message}: ${fields.slice(0, 3).map((d) => (d.field ? `${d.field} — ${d.message}` : d.message)).join('; ')}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function ErrorState({ error, onRetry, title = 'We could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <Card>
      <Empty
        icon={notFound ? 'search' : forbidden ? 'lock' : 'alert'}
        title={notFound ? 'Not found' : forbidden ? 'Not available for your role' : title}
        sub={errorMessage(error)}
        action={onRetry && !notFound && !forbidden ? <Button icon="refresh" onClick={onRetry}>Try again</Button> : undefined}
      />
    </Card>
  );
}

/**
 * Renders loading / error / empty / content for a query result in one line:
 *   <QueryState query={q} empty={!q.data?.length && <Empty …/>}>{(data) => …}</QueryState>
 */
export function QueryState<T>({ query, children, skeleton, empty }: {
  query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  empty?: ReactNode | false;
}) {
  if (query.isLoading) return <>{skeleton ?? <PageSkeleton />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="banner banner--critical" role="alert">
      <Icon name="alert" size={17} />
      <div className="grow">{errorMessage(error)}</div>
    </div>
  );
}
