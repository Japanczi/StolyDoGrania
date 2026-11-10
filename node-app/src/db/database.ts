// Opens the SQLite database and wraps it in Kysely.
// Counterpart of `AddDbContext<ApplicationDbContext>(o => o.UseSqlite(...))` in Program.cs – but there is
// no DbContext per request and no change tracker: one connection for the whole app, and every query is explicit.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import SqliteDatabase from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database } from './schema.ts';

export type Db = Kysely<Database>;

/**
 * Opens (or creates) the database file. `':memory:'` gives a private, empty database – used by tests,
 * like the in-memory SQLite connection in Planszowkarz.Tests.
 */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new SqliteDatabase(path);
  // WAL: readers don't block the writer (EF Core's SQLite provider turns this on too).
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  // SQLite ignores foreign keys unless asked, per connection.
  sqlite.pragma('foreign_keys = ON');
  // Wait up to 5 s instead of failing at once if another process (e.g. a migration) holds a lock.
  sqlite.pragma('busy_timeout = 5000');

  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
}
