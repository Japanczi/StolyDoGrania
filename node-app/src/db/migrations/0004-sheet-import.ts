// TEMPORARY: columns for the Google sign-up sheet import (src/import/). Port of the EF columns
// PlayTable.ImportKey / ImportOrder, TableSlot.IsImported and Game.IsFromSheet.
// Kept in a migration of its own so that removing the import later is one new migration dropping these columns.

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Which sheet row a table mirrors (normalized title + "#occurrence"); null for tables created in the app.
  // SQLite can't add a UNIQUE column, so uniqueness comes from an index (several nulls are allowed).
  await db.schema.alterTable('play_tables').addColumn('import_key', 'text').execute();
  await db.schema.createIndex('play_tables_import_key').unique().on('play_tables').column('import_key').execute();
  // The row's position in the sheet (0 = first), so imported tables list in the sheet's order; null for app tables.
  await db.schema.alterTable('play_tables').addColumn('import_order', 'integer').execute();

  // 1 for a seat copied from the sheet: the import owns it and may change or remove it.
  await db.schema.alterTable('table_slots')
    .addColumn('is_imported', 'integer', col => col.notNull().defaultTo(0).check(sql`is_imported in (0, 1)`))
    .execute();

  // 1 for a game the import added to the catalog; deleted again once no table uses it.
  await db.schema.alterTable('games')
    .addColumn('is_from_sheet', 'integer', col => col.notNull().defaultTo(0).check(sql`is_from_sheet in (0, 1)`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('games').dropColumn('is_from_sheet').execute();
  await db.schema.alterTable('table_slots').dropColumn('is_imported').execute();
  await db.schema.alterTable('play_tables').dropColumn('import_order').execute();
  await db.schema.dropIndex('play_tables_import_key').execute();
  await db.schema.alterTable('play_tables').dropColumn('import_key').execute();
}
