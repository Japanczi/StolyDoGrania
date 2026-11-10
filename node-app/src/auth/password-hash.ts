// Password hashing with Node's built-in node:crypto – no package needed.
//
// - New hashes: scrypt, stored as "scrypt$N$r$p$salt$key" (base64url), so the cost can be raised later and old
//   hashes still verify (the same idea as Identity's header).
// - Old hashes from the .NET app: ASP.NET Identity v3 (PBKDF2). They are verified by reading the parameters
//   from the hash's own header, and replaced with a scrypt hash after the next successful login.
// See docs/learning/sessions-and-passwords.md.

import { pbkdf2, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

// promisify() can't see scrypt's overload with options, so it's wrapped by hand.
function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** OWASP's scrypt option with 16 MiB of memory per hash: N=2^14, r=8, p=5. Fine on the 1 GB server. */
export const scryptParams = { N: 2 ** 14, r: 8, p: 5 } as const;
const scryptKeyLength = 32;
const saltLength = 16;

export type VerifyResult = {
  ok: boolean;
  /** True when the password was right but the hash uses an old format or weaker parameters: store a new one. */
  needsRehash: boolean;
};

/** Hashes a new password with scrypt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const { N, r, p } = scryptParams;
  const key = await scryptAsync(password, salt, scryptKeyLength, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Checks a password against a stored hash of either format. Never throws for a malformed hash: it just fails. */
export async function verifyPassword(storedHash: string, password: string): Promise<VerifyResult> {
  if (storedHash.startsWith('scrypt$')) {
    return verifyScrypt(storedHash, password);
  }
  const ok = await verifyIdentityV3(storedHash, password);
  return { ok, needsRehash: ok };
}

async function verifyScrypt(storedHash: string, password: string): Promise<VerifyResult> {
  const [, nText, rText, pText, saltText, keyText] = storedHash.split('$');
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!saltText || !keyText || ![N, r, p].every(Number.isSafeInteger)) {
    return { ok: false, needsRehash: false };
  }
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64url'), expected.length, {
    N, r, p, maxmem: 256 * N * r + 1024 * 1024,
  });
  const ok = timingSafeEqual(actual, expected);
  const weaker = N < scryptParams.N || r < scryptParams.r || p < scryptParams.p;
  return { ok, needsRehash: ok && weaker };
}

// ---------- ASP.NET Identity v3 ----------

// Identity's KeyDerivationPrf enum: which HMAC PBKDF2 used.
const identityPrfs: Record<number, string> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };

/**
 * Verifies an ASP.NET Identity "v3" hash (PasswordHasher, IdentityV3 format). Base64 of:
 *   byte 0      format marker, 0x01
 *   bytes 1–4   PRF (0 = SHA-1, 1 = SHA-256, 2 = SHA-512), big-endian uint32
 *   bytes 5–8   iteration count, big-endian uint32
 *   bytes 9–12  salt length, big-endian uint32
 *   then        the salt, then the derived key (the rest)
 * The .NET app's hashes are SHA-512 with 100 000 iterations, but every value is read from the header.
 */
export async function verifyIdentityV3(storedHash: string, password: string): Promise<boolean> {
  const bytes = Buffer.from(storedHash, 'base64');
  if (bytes.length < 13 || bytes[0] !== 0x01) {
    return false;
  }
  const digest = identityPrfs[bytes.readUInt32BE(1)];
  const iterations = bytes.readUInt32BE(5);
  const saltLengthInHash = bytes.readUInt32BE(9);
  // Identity requires a salt of at least 128 bits and a key of at least 128 bits.
  if (!digest || iterations < 1 || iterations > 10_000_000 || saltLengthInHash < 16 || bytes.length < 13 + saltLengthInHash + 16) {
    return false;
  }
  const salt = bytes.subarray(13, 13 + saltLengthInHash);
  const expected = bytes.subarray(13 + saltLengthInHash);
  const actual = await pbkdf2Async(password, salt, iterations, expected.length, digest);
  return timingSafeEqual(actual, expected);
}
