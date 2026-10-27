import { forbidden } from '../utils/errors.js';
import type { AuthUser } from '../types.js';

/**
 * Every approve / reject decision in the app belongs to the Super Admin
 * (permission `approvals.decide`). Other roles prepare and submit. Use this
 * where one endpoint handles both preparing and deciding transitions.
 */
export function canDecide(user: AuthUser | undefined) {
  return !!user?.permissions.has('approvals.decide');
}

export function assertDecider(user: AuthUser | undefined, what = 'This decision') {
  if (!canDecide(user)) throw forbidden(`${what} is reserved for the Super Admin, who alone approves or rejects`, 'SUPER_ADMIN_APPROVAL_REQUIRED');
}
