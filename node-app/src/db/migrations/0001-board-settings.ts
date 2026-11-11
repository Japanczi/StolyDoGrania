// First migration: the single-row board settings table (EF migration AddBoardSettings in the .NET app).
// Migrations receive Kysely<unknown>, because they must keep working after schema.ts changes.

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('board_settings')
    .addColumn('id', 'integer', col => col.primaryKey().check(sql`id = 1`))
    .addColumn('auto_reset_enabled', 'integer', col => col.notNull().defaultTo(0).check(sql`auto_reset_enabled in (0, 1)`))
    .addColumn('auto_reset_checked_utc', 'text')
    .execute();

  // The one row always exists, so code can read it without "create if missing" logic.
  await sql`insert into board_settings (id, auto_reset_enabled) values (1, 0)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('board_settings').execute();
}
