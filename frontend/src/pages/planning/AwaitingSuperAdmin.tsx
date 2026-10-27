import { Badge } from '@/components/ui';

/**
 * Shown where a non-Super-Admin would otherwise see Approve / Reject buttons:
 * every approval decision in the app belongs to the Super Admin (approvals.decide).
 */
export function AwaitingSuperAdmin({ short }: { short?: boolean }) {
  return (
    <Badge tone="caution" icon="clock" title="Only the Super Admin can approve or reject">
      {short ? 'With Super Admin' : 'Awaiting Super Admin approval'}
    </Badge>
  );
}
