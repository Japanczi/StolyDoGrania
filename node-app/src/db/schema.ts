// TypeScript description of every database table, used by Kysely to type-check queries
// (a misspelt column is a compile error, as with LINQ over EF Core entities).
// Written by hand and kept in step with src/db/migrations/ – a test checks they match.
//
// SQLite has no boolean or date types: booleans are INTEGER 0/1, instants are TEXT in ISO 8601 UTC
// ("2026-11-10T18:00:00.000Z").

/** board_settings: one row (id = 1) with board-wide settings. Port of Data/Table/BoardSettings.cs. */
export type BoardSettingsTable = {
  id: number;
  /** 0/1 – the admin toolbox's "Auto" switch: clear the board every Monday 00:00 (Europe/Warsaw). */
  auto_reset_enabled: number;
  /** When the last automatic reset ran or the switch was turned on; null until first switched on. */
  auto_reset_checked_utc: string | null;
};

export type Role = 'owner' | 'admin' | 'user';

/** users: one row per account. Replaces Identity's AspNetUsers + role tables. */
export type UsersTable = {
  /** GUID string (kept from the .NET app for existing users). */
  id: string;
  /** Shown to other players; 3–20 characters, normalised (see domain/user-name.ts). */
  user_name: string;
  /** user_name upper-cased, for case-insensitive lookups; unique. */
  normalized_user_name: string;
  email: string;
  /** email upper-cased; unique. */
  normalized_email: string;
  /** 0/1 – login needs a confirmed address. */
  email_confirmed: number;
  /** "scrypt$…" for new hashes, or an ASP.NET Identity v3 hash for migrated users until their next login. */
  password_hash: string | null;
  phone_number: string | null;
  role: Role;
  /** Failed logins in a row; reset on success. */
  access_failed_count: number;
  /** Locked out until this instant (ISO 8601 UTC), or null. */
  lockout_end_utc: string | null;
  created_utc: string;
};

/** sessions: logins. The cookie holds a random id; only its SHA-256 is stored here. */
export type SessionsTable = {
  id_hash: string;
  user_id: string;
  /** 'full' = logged in; 'password' = waiting for a second step (2FA, not built yet). */
  auth_level: 'password' | 'full';
  /** 0/1 – "Zapamiętaj mnie". */
  persistent: number;
  created_utc: string;
  expires_utc: string;
};

export type TokenPurpose = 'confirm-email' | 'change-email' | 'reset-password';

/** user_tokens: one-time tokens sent in e-mail links; only their SHA-256 is stored. */
export type UserTokensTable = {
  token_hash: string;
  user_id: string;
  purpose: TokenPurpose;
  /** For 'change-email': the new address. */
  new_email: string | null;
  expires_utc: string;
};

/** All tables, by name. */
export type Database = {
  board_settings: BoardSettingsTable;
  users: UsersTable;
  sessions: SessionsTable;
  user_tokens: UserTokensTable;
};
