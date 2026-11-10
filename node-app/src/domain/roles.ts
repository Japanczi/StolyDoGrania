// Role rules. Port of Data/AppRoles.cs. Users have one role: owner (main admin, always also an admin),
// admin or user. (Identity allowed several roles per user; the app only ever used the highest one.)

import type { Role } from '../db/schema.ts';

export function isAdminRole(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Whether an admin may change the role of, or delete, a user with `targetRole`:
 * nobody touches the Owner, and only the Owner touches other admins.
 */
export function canManage(targetRole: Role, actorIsOwner: boolean): boolean {
  switch (targetRole) {
    case 'owner':
      return false;
    case 'admin':
      return actorIsOwner;
    case 'user':
      return true;
  }
}
