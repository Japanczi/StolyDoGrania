// The board: games catalog (+ alternate names), tables, seats, the phrases typed to create tables, and the
// user action log. EF tables Games, GameAlternateNames, PlayTables, TableSlots, TablePhrases, UserActionLogs.
// The sign-up sheet import adds its own columns in a later migration (it stays isolated and removable).

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('games')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    // Unique, case-insensitively (editions sharing a name get the year added, see domain/game.ts).
    .addColumn('name', 'text', col => col.notNull().unique().modifyEnd(sql`collate nocase`))
    .addColumn('kind', 'text', col => col.notNull().defaultTo('small').check(sql`kind in ('small', 'big', 'other')`))
    // BGG's average weight exactly as BGG gave it, as text ("2.0488"); "0" = not rated. Never entered by users.
    .addColumn('weight', 'text', col => col.notNull().defaultTo('0'))
    .addColumn('max_players', 'integer', col => col.notNull())
    .addColumn('bgg_url', 'text')
    .addColumn('bgg_id', 'integer', col => col.unique())
    .addColumn('year_published', 'integer')
    // The cover is stored in the database (downloaded once from BGG, or uploaded), never hot-linked.
    .addColumn('cover', 'blob')
    .addColumn('cover_type', 'text')
    .execute();

  await db.schema
    .createTable('game_alternate_names')
    .addColumn('game_id', 'integer', col => col.notNull().references('games.id').onDelete('cascade'))
    .addColumn('name', 'text', col => col.notNull().modifyEnd(sql`collate nocase`))
    .addPrimaryKeyConstraint('game_alternate_names_pk', ['game_id', 'name'])
    .execute();

  await db.schema
    .createTable('play_tables')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    // A game with tables can't be deleted from the catalog.
    .addColumn('game_id', 'integer', col => col.notNull().references('games.id').onDelete('restrict'))
    .addColumn('game_title', 'text')
    // "HH:MM" or null (hour only, no date: users know which day it is).
    .addColumn('start_hour', 'text')
    .addColumn('max_players', 'integer', col => col.notNull().check(sql`max_players >= 1`))
    .addColumn('kind', 'text', col => col.notNull().defaultTo('small').check(sql`kind in ('small', 'big', 'other')`))
    // A deleted account leaves its tables behind, without an owner (decided 2026-11-10).
    .addColumn('owner_user_id', 'text', col => col.references('users.id').onDelete('set null'))
    .addColumn('taken_slots', 'integer', col => col.notNull().defaultTo(0).check(sql`taken_slots >= 0`))
    .execute();

  await db.schema
    .createTable('table_slots')
    .addColumn('play_table_id', 'integer', col => col.notNull().references('play_tables.id').onDelete('cascade'))
    .addColumn('slot_number', 'integer', col => col.notNull().check(sql`slot_number >= 1`))
    .addColumn('participant_name', 'text', col => col.notNull())
    // A deleted account's seats stay, showing the name (decided 2026-11-10).
    .addColumn('user_id', 'text', col => col.references('users.id').onDelete('set null'))
    .addPrimaryKeyConstraint('table_slots_pk', ['play_table_id', 'slot_number'])
    .execute();
  // One seat per user per table, enforced by the database too (TryTakeSlot checks it first).
  await sql`create unique index table_slots_one_seat_per_user on table_slots (play_table_id, user_id) where user_id is not null`.execute(db);

  await db.schema
    .createTable('table_phrases')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('phrase', 'text', col => col.notNull())
    // The phrase stays when its game is deleted from Baza gier.
    .addColumn('game_id', 'integer', col => col.references('games.id').onDelete('set null'))
    // Stored only, never displayed.
    .addColumn('user_id', 'text')
    .addColumn('created_utc', 'text', col => col.notNull())
    .execute();

  await db.schema
    .createTable('user_action_logs')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('created_utc', 'text', col => col.notNull())
    // JoinedTable, RoleChanged, UserRemoved – stored as text, so new kinds can be added freely.
    .addColumn('action', 'text', col => col.notNull())
    // Names are copied in, so entries stay readable after users and tables are gone. No foreign keys on purpose.
    .addColumn('actor_user_id', 'text')
    .addColumn('actor_name', 'text')
    .addColumn('target_user_id', 'text')
    .addColumn('target_name', 'text')
    .addColumn('play_table_id', 'integer')
    .addColumn('details', 'text')
    .execute();
  await db.schema.createIndex('user_action_logs_created').on('user_action_logs').column('created_utc').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_action_logs').execute();
  await db.schema.dropTable('table_phrases').execute();
  await db.schema.dropTable('table_slots').execute();
  await db.schema.dropTable('play_tables').execute();
  await db.schema.dropTable('game_alternate_names').execute();
  await db.schema.dropTable('games').execute();
}
