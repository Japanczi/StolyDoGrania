// The single board_settings row and clearing the board. Port of Data/Table/BoardResetter.cs.

import type { Kysely } from 'kysely';
import type { AutoResetSettings } from '../../domain/board-settings.ts';
import type { Database } from '../schema.ts';

type Executor = Kysely<Database>;

export async function getAutoReset(db: Executor): Promise<AutoResetSettings> {
  const row = await db.selectFrom('board_settings').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  return { enabled: row.auto_reset_enabled === 1, checkedUtc: row.auto_reset_checked_utc ? new Date(row.auto_reset_checked_utc) : null };
}

export async function saveAutoReset(db: Executor, settings: AutoResetSettings): Promise<void> {
  await db.updateTable('board_settings')
    .set({ auto_reset_enabled: settings.enabled ? 1 : 0, auto_reset_checked_utc: settings.checkedUtc?.toISOString() ?? null })
    .where('id', '=', 1)
    .execute();
}

/** Removes every table (their seats go too, ON DELETE CASCADE); games stay in the catalog. Returns how many. */
export async function clearTables(db: Executor): Promise<number> {
  const result = await db.deleteFrom('play_tables').executeTakeFirst();
  return Number(result.numDeletedRows);
}

export async function countTables(db: Executor): Promise<number> {
  const row = await db.selectFrom('play_tables').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
  return Number(row.n);
}
