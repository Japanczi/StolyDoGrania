// Login sessions, written by hand (no session library). What ASP.NET Identity's cookie authentication did for us.
//
// After a successful login the browser gets a cookie holding a random session id. Every request sends it back;
// we hash it and look the session up in the `sessions` table. Logging out (or a password change) deletes rows,
// which ends those sessions at once – the job of Identity's security stamp.
// See docs/learning/sessions-and-passwords.md.

import type { Db } from '../db/database.ts';
import type { Role, SessionsTable } from '../db/schema.ts';
import { randomToken, sha256 } from './random.ts';

/** Sessions last 14 days (Identity's cookie default) and slide: using the app pushes the end back. */
export const sessionLifetimeMs = 14 * 24 * 60 * 60 * 1000;
/** Extend only when less than half is left, so most requests don't write to the database. */
const renewWhenLeftMs = sessionLifetimeMs / 2;

/** The signed-in user, as request handlers see it. */
export type SessionUser = {
  id: string;
  userName: string;
  email: string;
  role: Role;
  /** 0/1 from the database turned into a boolean. */
  emailConfirmed: boolean;
};

export type LoadedSession = {
  user: SessionUser;
  idHash: string;
  persistent: boolean;
  /** Set when the expiry was pushed back: the cookie must be sent again with the new Max-Age. */
  renewedExpires: Date | null;
};

/** Creates a session and returns the id to put in the cookie (the database only gets its hash). */
export async function createSession(
  db: Db, userId: string, opts: { persistent: boolean; authLevel: SessionsTable['auth_level'] }, now: Date = new Date(),
): Promise<{ id: string; expires: Date }> {
  const id = randomToken();
  const expires = new Date(now.getTime() + sessionLifetimeMs);
  await db.insertInto('sessions').values({
    id_hash: sha256(id),
    user_id: userId,
    auth_level: opts.authLevel,
    persistent: opts.persistent ? 1 : 0,
    created_utc: now.toISOString(),
    expires_utc: expires.toISOString(),
  }).execute();
  return { id, expires };
}

/**
 * Finds the user behind a session cookie. Only 'full' sessions count as logged in; an expired session is
 * deleted. The user row is read fresh every time, so a role change or account deletion applies at once
 * (Identity needed its revalidating auth state provider for that).
 */
export async function loadSession(db: Db, sessionId: string, now: Date = new Date()): Promise<LoadedSession | null> {
  const idHash = sha256(sessionId);
  const row = await db.selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.expires_utc', 'sessions.auth_level', 'sessions.persistent',
      'users.id', 'users.user_name', 'users.email', 'users.role', 'users.email_confirmed',
    ])
    .where('sessions.id_hash', '=', idHash)
    .executeTakeFirst();

  if (!row) {
    return null;
  }
  if (row.expires_utc <= now.toISOString()) {
    await db.deleteFrom('sessions').where('id_hash', '=', idHash).execute();
    return null;
  }
  if (row.auth_level !== 'full') {
    return null;
  }

  let renewedExpires: Date | null = null;
  if (new Date(row.expires_utc).getTime() - now.getTime() < renewWhenLeftMs) {
    renewedExpires = new Date(now.getTime() + sessionLifetimeMs);
    await db.updateTable('sessions').set({ expires_utc: renewedExpires.toISOString() }).where('id_hash', '=', idHash).execute();
  }

  return {
    user: { id: row.id, userName: row.user_name, email: row.email, role: row.role, emailConfirmed: row.email_confirmed === 1 },
    idHash,
    persistent: row.persistent === 1,
    renewedExpires,
  };
}

/** Ends one session (logout). */
export async function deleteSession(db: Db, idHash: string): Promise<void> {
  await db.deleteFrom('sessions').where('id_hash', '=', idHash).execute();
}

/**
 * Ends every session of a user except, optionally, the current one – after a password change or reset,
 * so a thief who knew the old password is logged out everywhere.
 */
export async function deleteUserSessions(db: Db, userId: string, exceptIdHash: string | null = null): Promise<void> {
  let query = db.deleteFrom('sessions').where('user_id', '=', userId);
  if (exceptIdHash !== null) {
    query = query.where('id_hash', '!=', exceptIdHash);
  }
  await query.execute();
}
