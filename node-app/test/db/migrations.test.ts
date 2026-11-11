import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sql } from 'kysely';
import { openDatabase } from '../../src/db/database.ts';
import { migrateToLatest, pendingMigrations } from '../../src/db/migrator.ts';
import { migrations } from '../../src/db/migrations/index.ts';
import type { Database } from '../../src/db/schema.ts';

/**
 * Every column of every table in schema.ts. The type makes the compiler insist that this list names exactly
 * the columns schema.ts declares; the test below checks the database has exactly these columns.
 * Together they keep schema.ts and the migrations in step.
 */
const expectedColumns: { [T in keyof Database]: Record<keyof Database[T], true> } = {
  board_settings: { id: true, auto_reset_enabled: true, auto_reset_checked_utc: true },
  users: {
    id: true, user_name: true, normalized_user_name: true, email: true, normalized_email: true, email_confirmed: true,
    password_hash: true, phone_number: true, role: true, access_failed_count: true, lockout_end_utc: true, created_utc: true,
  },
  sessions: { id_hash: true, user_id: true, auth_level: true, persistent: true, created_utc: true, expires_utc: true },
  user_tokens: { token_hash: true, user_id: true, purpose: true, new_email: true, expires_utc: true },
  games: {
    id: true, name: true, kind: true, weight: true, max_players: true, bgg_url: true, bgg_id: true, year_published: true,
    cover: true, cover_type: true, is_from_sheet: true,
  },
  game_alternate_names: { game_id: true, name: true },
  play_tables: {
    id: true, game_id: true, game_title: true, start_hour: true, max_players: true, kind: true, owner_user_id: true, taken_slots: true,
    import_key: true, import_order: true,
  },
  table_slots: { play_table_id: true, slot_number: true, participant_name: true, user_id: true, is_imported: true },
  table_phrases: { id: true, phrase: true, game_id: true, user_id: true, created_utc: true },
  user_action_logs: {
    id: true, created_utc: true, action: true, actor_user_id: true, actor_name: true, target_user_id: true, target_name: true,
    play_table_id: true, details: true,
  },
};

describe('migrations', () => {
  test('a new database has every migration pending, and none after migrating', async t => {
    const db = openDatabase(':memory:');
    t.after(() => db.destroy());

    assert.deepEqual(await pendingMigrations(db), Object.keys(migrations));
    assert.deepEqual(await migrateToLatest(db), Object.keys(migrations));
    assert.deepEqual(await pendingMigrations(db), []);
    assert.deepEqual(await migrateToLatest(db), [], 'running again applies nothing');
  });

  test('the database matches schema.ts', async t => {
    const db = openDatabase(':memory:');
    t.after(() => db.destroy());
    await migrateToLatest(db);

    for (const [table, columns] of Object.entries(expectedColumns)) {
      const info = await sql<{ name: string }>`select name from pragma_table_info(${table})`.execute(db);
      assert.deepEqual(info.rows.map(r => r.name).sort(), Object.keys(columns).sort(), `columns of ${table}`);
    }
  });

  test('board_settings starts with its single row, switched off', async t => {
    const db = openDatabase(':memory:');
    t.after(() => db.destroy());
    await migrateToLatest(db);

    const rows = await db.selectFrom('board_settings').selectAll().execute();
    assert.deepEqual(rows, [{ id: 1, auto_reset_enabled: 0, auto_reset_checked_utc: null }]);
  });

  test('board_settings refuses a second row', async t => {
    const db = openDatabase(':memory:');
    t.after(() => db.destroy());
    await migrateToLatest(db);

    await assert.rejects(db.insertInto('board_settings').values({ id: 2, auto_reset_enabled: 0, auto_reset_checked_utc: null }).execute());
  });

  test('every migration can be rolled back', async t => {
    const db = openDatabase(':memory:');
    t.after(() => db.destroy());
    await migrateToLatest(db);

    for (const name of Object.keys(migrations).reverse()) {
      await migrations[name]?.down?.(db);
    }
    const tables = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name not like 'kysely_%' and name not like 'sqlite_%'`.execute(db);
    assert.deepEqual(tables.rows, []);
  });
});
