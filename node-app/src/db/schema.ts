// TypeScript description of every database table, used by Kysely to type-check queries
// (a misspelt column is a compile error, as with LINQ over EF Core entities).
// Written by hand and kept in step with src/db/migrations/ – a test checks they match.
//
// SQLite has no boolean or date types: booleans are INTEGER 0/1, instants are TEXT in ISO 8601 UTC
// ("2026-11-10T18:00:00.000Z").
// Generated<T>: a column the database fills in (autoincrement id) – optional on insert, present on select.

import type { Generated } from 'kysely';
import type { TableKind } from '../domain/play-table.ts';

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

/** games: the catalog. Port of Game.cs. */
export type GamesTable = {
  id: Generated<number>;
  /** Unique (case-insensitive). */
  name: string;
  kind: TableKind;
  /** BGG's average weight exactly as given ("2.0488"); "0" = not rated. */
  weight: string;
  max_players: number;
  bgg_url: string | null;
  /** Null for games added by hand. */
  bgg_id: number | null;
  year_published: number | null;
  cover: Buffer | null;
  cover_type: string | null;
};

export type GameAlternateNamesTable = {
  game_id: number;
  name: string;
};

/** play_tables: one table on the board. Port of PlayTable.cs (rules in domain/play-table.ts). */
export type PlayTablesTable = {
  id: Generated<number>;
  game_id: number;
  game_title: string | null;
  /** "HH:MM" or null. */
  start_hour: string | null;
  max_players: number;
  kind: TableKind;
  owner_user_id: string | null;
  taken_slots: number;
};

export type TableSlotsTable = {
  play_table_id: number;
  slot_number: number;
  participant_name: string;
  user_id: string | null;
};

export type TablePhrasesTable = {
  id: Generated<number>;
  phrase: string;
  game_id: number | null;
  user_id: string | null;
  created_utc: string;
};

export type UserActionLogsTable = {
  id: Generated<number>;
  created_utc: string;
  action: 'JoinedTable' | 'RoleChanged' | 'UserRemoved';
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  play_table_id: number | null;
  details: string | null;
};

/** All tables, by name. */
export type Database = {
  board_settings: BoardSettingsTable;
  users: UsersTable;
  sessions: SessionsTable;
  user_tokens: UserTokensTable;
  games: GamesTable;
  game_alternate_names: GameAlternateNamesTable;
  play_tables: PlayTablesTable;
  table_slots: TableSlotsTable;
  table_phrases: TablePhrasesTable;
  user_action_logs: UserActionLogsTable;
};
