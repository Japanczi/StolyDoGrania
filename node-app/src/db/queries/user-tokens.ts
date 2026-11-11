// One-time tokens for e-mail links (confirm e-mail, change e-mail, reset password).
// Identity made these with its DataProtectorTokenProvider (signed, valid 1 day); here they are random values
// stored as SHA-256 hashes with a purpose and an expiry, and deleted when used.

import { randomToken, sha256 } from '../../auth/random.ts';
import type { Db } from '../database.ts';
import type { TokenPurpose } from '../schema.ts';

/** Same lifetime as Identity's default token provider. */
export const tokenLifetimeMs = 24 * 60 * 60 * 1000;

/** Creates a token and returns it (the only time it exists in plain form: it goes into the e-mail link). */
export async function createUserToken(
  db: Db, userId: string, purpose: TokenPurpose, newEmail: string | null = null, now: Date = new Date(),
): Promise<string> {
  const token = randomToken();
  await db.insertInto('user_tokens').values({
    token_hash: sha256(token),
    user_id: userId,
    purpose,
    new_email: newEmail,
    expires_utc: new Date(now.getTime() + tokenLifetimeMs).toISOString(),
  }).execute();
  return token;
}

export type UsedToken = { userId: string; newEmail: string | null };

/**
 * Uses up a token: returns its data if it exists, has this purpose and hasn't expired, and deletes it either way
 * so it can't be tried again. `userId`, when given, must match (the confirm links carry it, as in .NET).
 */
export async function consumeUserToken(
  db: Db, token: string, purpose: TokenPurpose, userId: string | null = null, now: Date = new Date(),
): Promise<UsedToken | null> {
  const row = await db.deleteFrom('user_tokens')
    .where('token_hash', '=', sha256(token))
    .where('purpose', '=', purpose)
    .returning(['user_id', 'new_email', 'expires_utc'])
    .executeTakeFirst();
  if (!row || row.expires_utc <= now.toISOString() || (userId !== null && row.user_id !== userId)) {
    return null;
  }
  return { userId: row.user_id, newEmail: row.new_email };
}

/** Checks a token without using it up (the reset page shows the form first, the token is used on submit). */
export async function peekUserToken(db: Db, token: string, purpose: TokenPurpose, now: Date = new Date()): Promise<string | null> {
  const row = await db.selectFrom('user_tokens').select(['user_id', 'expires_utc'])
    .where('token_hash', '=', sha256(token)).where('purpose', '=', purpose).executeTakeFirst();
  return row && row.expires_utc > now.toISOString() ? row.user_id : null;
}

/** Removes a user's tokens of one purpose, e.g. all reset links once the password has changed. */
export async function deleteUserTokens(db: Db, userId: string, purpose: TokenPurpose): Promise<void> {
  await db.deleteFrom('user_tokens').where('user_id', '=', userId).where('purpose', '=', purpose).execute();
}
