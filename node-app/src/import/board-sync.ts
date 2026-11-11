// TEMPORARY – the Google sign-up sheet import. Port of Data/Import/SheetBoardSync.cs.
// Makes the imported tables match the sign-up sheet 1:1: adds new rows, updates changed ones and removes tables
// whose row is gone. Tables created in the app, and seats taken in the app, are left alone (see applyImport).
// Uses its own queries (not db/queries/board.ts), so the board code doesn't depend on the import.

import type { Kysely } from 'kysely';
import type { Db } from '../db/database.ts';
import type { Database } from '../db/schema.ts';
import type { PlayTable } from '../domain/play-table.ts';
import { applyImport } from './apply-import.ts';
import { keysFor, type SheetTableRow } from './sheet-parser.ts';

export type SheetSyncResult = {
  added: number;
  /** Tables whose row was found again (checked; not necessarily changed). */
  updated: number;
  removed: number;
  droppedPlayers: string[];
  /** True when anything on the board changed (the caller then tells open pages). */
  changed: boolean;
};

type Executor = Kysely<Database>;
type CatalogGame = { id: number; name: string; weight: string; alternateNames: string[] };

const sameText = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** Everything the import may change about a table, to tell whether it changed. */
const snapshot = (t: PlayTable, importOrder: number | null) =>
  JSON.stringify([t.gameId, t.gameTitle, t.kind, t.maxPlayers, t.startHour, t.takenSlots, importOrder,
    t.participants.map(p => [p.slotNumber, p.participantName, p.userId, p.isImported === true])]);

/** Syncs the board with the sheet's rows, in one transaction. */
export async function syncSheet(db: Db, rows: readonly SheetTableRow[]): Promise<SheetSyncResult> {
  return db.transaction().execute(trx => syncInTransaction(trx, rows));
}

async function syncInTransaction(trx: Executor, rows: readonly SheetTableRow[]): Promise<SheetSyncResult> {
  const tables = await loadImportedTables(trx);
  const catalog = await loadCatalog(trx);
  const newGames = new Map<string, number>();

  let added = 0;
  let updated = 0;
  let changed = false;
  const dropped: string[] = [];
  const keys = keysFor(rows);

  for (const [i, row] of rows.entries()) {
    const key = keys[i] ?? '';
    const existing = tables.get(key);
    tables.delete(key);
    const before = existing ? snapshot(existing.table, existing.importOrder) : null;
    const table: PlayTable = existing?.table ?? {
      id: 0, gameId: 0, gameTitle: null, startHour: null, maxPlayers: 1, kind: 'small', ownerUserId: null, takenSlots: 0, participants: [],
    };

    // A catalog game of that name (or alternate name) is reused untouched, apart from filling in a missing weight.
    const known = catalog.find(g => sameText(g.name, row.title))
      ?? catalog.find(g => g.alternateNames.some(a => sameText(a, row.title)));
    if (known) {
      table.gameId = known.id;
      if (Number(known.weight) === 0 && Number(row.weight) > 0) {
        await trx.updateTable('games').set({ weight: row.weight }).where('id', '=', known.id).execute();
        known.weight = row.weight;
        changed = true;
      }
    } else {
      const titleKey = row.title.toUpperCase();
      let gameId = newGames.get(titleKey);
      if (gameId === undefined) {
        const inserted = await trx.insertInto('games').values({
          name: row.title, kind: row.kind, max_players: row.maxPlayers, weight: row.weight, is_from_sheet: 1,
        }).returning('id').executeTakeFirstOrThrow();
        gameId = inserted.id;
        newGames.set(titleKey, gameId);
      }
      table.gameId = gameId;
    }

    dropped.push(...applyImport(table, row));

    if (existing) {
      updated++;
      if (snapshot(table, i) !== before) {
        changed = true;
        await saveImportedTable(trx, table, i);
      }
    } else {
      added++;
      changed = true;
      const inserted = await trx.insertInto('play_tables').values({
        game_id: table.gameId, game_title: table.gameTitle, start_hour: table.startHour, max_players: table.maxPlayers,
        kind: table.kind, owner_user_id: null, taken_slots: table.takenSlots, import_key: key, import_order: i,
      }).returning('id').executeTakeFirstOrThrow();
      table.id = inserted.id;
      await saveImportedTable(trx, table, i);
    }
  }

  // Whatever is left has no row in the sheet any more, app players included (seats go with the table: cascade).
  const gone = [...tables.values()].map(t => t.table.id);
  if (gone.length > 0) {
    await trx.deleteFrom('play_tables').where('id', 'in', gone).execute();
    changed = true;
  }

  // Games the import added and nothing uses any more leave the catalog with their tables.
  // (bgg_id is null: a game that got BGG data in the meantime stays, even if the flag wasn't cleared.)
  await trx.deleteFrom('games')
    .where('is_from_sheet', '=', 1)
    .where('bgg_id', 'is', null)
    .where(eb => eb.not(eb.exists(eb.selectFrom('play_tables').select('play_tables.id').whereRef('play_tables.game_id', '=', 'games.id'))))
    .execute();

  return { added, updated, removed: gone.length, droppedPlayers: dropped, changed };
}

async function loadImportedTables(trx: Executor): Promise<Map<string, { table: PlayTable; importOrder: number | null }>> {
  const rows = await trx.selectFrom('play_tables').selectAll().where('import_key', 'is not', null).execute();
  const slots = await trx.selectFrom('table_slots').selectAll()
    .where('play_table_id', 'in', trx.selectFrom('play_tables').select('id').where('import_key', 'is not', null))
    .orderBy('slot_number')
    .execute();
  const result = new Map<string, { table: PlayTable; importOrder: number | null }>();
  for (const r of rows) {
    if (r.import_key === null) continue; // excluded by the query; narrows the type
    result.set(r.import_key, {
      importOrder: r.import_order,
      table: {
        id: r.id, gameId: r.game_id, gameTitle: r.game_title, startHour: r.start_hour, maxPlayers: r.max_players,
        kind: r.kind, ownerUserId: r.owner_user_id, takenSlots: r.taken_slots,
        participants: slots.filter(s => s.play_table_id === r.id).map(s => ({
          slotNumber: s.slot_number, participantName: s.participant_name, userId: s.user_id,
          ...(s.is_imported === 1 ? { isImported: true } : {}),
        })),
      },
    });
  }
  return result;
}

/** Names only: loading whole games would load every cover. */
async function loadCatalog(trx: Executor): Promise<CatalogGame[]> {
  const games = await trx.selectFrom('games').select(['id', 'name', 'weight']).execute();
  const alternates = await trx.selectFrom('game_alternate_names').select(['game_id', 'name']).execute();
  return games.map(g => ({ ...g, alternateNames: alternates.filter(a => a.game_id === g.id).map(a => a.name) }));
}

async function saveImportedTable(trx: Executor, table: PlayTable, importOrder: number): Promise<void> {
  await trx.updateTable('play_tables').set({
    game_id: table.gameId, game_title: table.gameTitle, start_hour: table.startHour, max_players: table.maxPlayers,
    kind: table.kind, taken_slots: table.takenSlots, import_order: importOrder,
  }).where('id', '=', table.id).execute();
  await trx.deleteFrom('table_slots').where('play_table_id', '=', table.id).execute();
  if (table.participants.length > 0) {
    await trx.insertInto('table_slots').values(table.participants.map(p => ({
      play_table_id: table.id, slot_number: p.slotNumber, participant_name: p.participantName, user_id: p.userId,
      is_imported: p.isImported === true ? 1 : 0,
    }))).execute();
  }
}
