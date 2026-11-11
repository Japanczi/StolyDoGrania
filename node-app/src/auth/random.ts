// Random secrets and their hashes, shared by sessions, CSRF tokens and e-mail tokens.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 32 random bytes as URL-safe text (43 characters): unguessable, safe in cookies and links. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 of a token, as hex. Stored instead of the token, so someone reading the database can't use it.
 * A fast hash is right here (unlike passwords): the token is random and long, so it can't be guessed.
 */
export function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new user id, a GUID string like Identity's. */
export function newUserId(): string {
  return randomUUID();
}
