// The login decision, step by step. What SignInManager.PasswordSignInAsync did in the .NET app.
//
// It is a separate function with an explicit result so a second step can be added later without rewriting it:
// for two-factor authentication, a correct password would return { kind: 'second-factor-required' } and the page
// would start a session with auth_level 'password' instead of 'full' (see sessions.ts). Not built in v1.

import type { Db } from '../db/database.ts';
import { findUserByLogin, setPasswordHash, type User } from '../db/queries/users.ts';
import { hashPassword, verifyPassword } from './password-hash.ts';

/** Identity's defaults: 5 failed attempts in a row lock the account for 5 minutes. */
export const maxFailedAttempts = 5;
export const lockoutMs = 5 * 60 * 1000;

export type LoginResult =
  | { kind: 'success'; user: User }
  | { kind: 'invalid' }
  | { kind: 'locked-out' }
  | { kind: 'email-not-confirmed'; user: User };

/**
 * Checks a login (e-mail or user name) and password.
 * - Unknown login or wrong password → 'invalid' (the page doesn't say which, so accounts can't be probed).
 * - Wrong password counts towards a lockout; the attempt that reaches the limit, and any attempt while locked,
 *   → 'locked-out'.
 * - Right password but unconfirmed e-mail → 'email-not-confirmed' (only someone who knows the password learns it).
 * - Success resets the counter and, for an old ASP.NET Identity hash, stores a new scrypt hash.
 */
export async function checkLogin(db: Db, login: string, password: string, now: Date = new Date()): Promise<LoginResult> {
  const user = await findUserByLogin(db, login.trim());
  if (!user || user.password_hash === null) {
    // Spend about as long as a real check, so response times don't reveal which logins exist.
    await verifyPassword(await dummyHash(), password);
    return { kind: 'invalid' };
  }
  if (user.lockout_end_utc !== null && user.lockout_end_utc > now.toISOString()) {
    return { kind: 'locked-out' };
  }

  const verified = await verifyPassword(user.password_hash, password);
  if (!verified.ok) {
    const failed = user.access_failed_count + 1;
    const lockNow = failed >= maxFailedAttempts;
    await db.updateTable('users')
      .set(lockNow
        ? { access_failed_count: 0, lockout_end_utc: new Date(now.getTime() + lockoutMs).toISOString() }
        : { access_failed_count: failed })
      .where('id', '=', user.id)
      .execute();
    return lockNow ? { kind: 'locked-out' } : { kind: 'invalid' };
  }

  if (user.access_failed_count !== 0 || user.lockout_end_utc !== null) {
    await db.updateTable('users').set({ access_failed_count: 0, lockout_end_utc: null }).where('id', '=', user.id).execute();
  }
  if (verified.needsRehash) {
    await setPasswordHash(db, user.id, await hashPassword(password));
  }
  if (user.email_confirmed !== 1) {
    return { kind: 'email-not-confirmed', user };
  }
  return { kind: 'success', user };
}

let dummy: Promise<string> | null = null;

/** A scrypt hash of a random password, made once, for the "unknown login" timing balance above. */
function dummyHash(): Promise<string> {
  dummy ??= hashPassword(crypto.randomUUID());
  return dummy;
}
