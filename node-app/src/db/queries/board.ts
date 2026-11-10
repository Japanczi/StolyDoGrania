// Reads and writes of tables and seats. Every write that depends on who is asking checks it inside the query
// (CLAUDE.md: "Enforce on the server side (in the query), not just by hiding buttons").
//
// Pattern for edits: load the table + seats inside a transaction, apply a rule from domain/play-table.ts in
// memory, then save the table row and replace its seats. No change tracker: saveTable writes exactly what changed.

import type { ExpressionBuilder, Kysely, Selectable } from 'kysely';
import type { Db } from '../database.ts';
import type { Database, GamesTable } from '../schema.ts';
import type { PlayTable, Result } from '../../domain/play-table.ts';

/** Who is asking. Built from the session in the route (never from anything the browser sends). */
export type Viewer = {
  userId: string | null;
  /** Shown on seats they take: the user name (never the e-mail). */
  name: string | null;
  isAdmin: boolean;
};

export type GameInfo = Pick<Selectable<GamesTable>, 'id' | 'name' | 'weight' | 'bgg_url' | 'bgg_id' | 'kind' | 'max_players' | 'year_published' | 'cover_type'>;

/**
 * A table with what the board shows about its game.
 * importKey/importOrder – TEMPORARY (sheet import, src/import/): non-null importKey = mirrored from the sign-up
 * sheet; such tables list below the app's own, in importOrder (the sheet's row order).
 */
export type BoardTable = PlayTable & { game: GameInfo; importKey: string | null; importOrder: number | null };

type Executor = Kysely<Database>;

const gameColumns = [
  'games.id', 'games.name', 'games.weight', 'games.bgg_url', 'games.bgg_id', 'games.kind', 'games.max_players',
  'games.year_published', 'games.cover_type',
] as const;

/** All tables in board order, with games and seats (two queries, joined in memory). */
export async function loadBoard(db: Executor): Promise<BoardTable[]> {
  return loadTables(db, null);
}

export async function loadBoardTable(db: Executor, tableId: number): Promise<BoardTable | null> {
  return (await loadTables(db, tableId))[0] ?? null;
}

async function loadTables(db: Executor, onlyId: number | null): Promise<BoardTable[]> {
  let tablesQuery = db.selectFrom('play_tables')
    .innerJoin('games', 'games.id', 'play_tables.game_id')
    .select([
      'play_tables.id as table_id', 'play_tables.game_title', 'play_tables.start_hour', 'play_tables.max_players as table_max_players',
      'play_tables.kind as table_kind', 'play_tables.owner_user_id', 'play_tables.taken_slots',
      'play_tables.import_key', 'play_tables.import_order', ...gameColumns,
    ])
    .orderBy('play_tables.id');
  let slotsQuery = db.selectFrom('table_slots').selectAll().orderBy('slot_number');
  if (onlyId !== null) {
    tablesQuery = tablesQuery.where('play_tables.id', '=', onlyId);
    slotsQuery = slotsQuery.where('play_table_id', '=', onlyId);
  }
  const [rows, slots] = await Promise.all([tablesQuery.execute(), slotsQuery.execute()]);

  return rows.map(r => ({
    id: r.table_id,
    gameId: r.id,
    gameTitle: r.game_title,
    startHour: r.start_hour,
    maxPlayers: r.table_max_players,
    kind: r.table_kind,
    ownerUserId: r.owner_user_id,
    takenSlots: r.taken_slots,
    participants: slots
      .filter(s => s.play_table_id === r.table_id)
      .map(s => ({
        slotNumber: s.slot_number, participantName: s.participant_name, userId: s.user_id,
        // Sheet import seats keep their flag through edits (saveTable writes it back).
        ...(s.is_imported === 1 ? { isImported: true } : {}),
      })),
    game: {
      id: r.id, name: r.name, weight: r.weight, bgg_url: r.bgg_url, bgg_id: r.bgg_id, kind: r.kind,
      max_players: r.max_players, year_published: r.year_published, cover_type: r.cover_type,
    },
    importKey: r.import_key,
    importOrder: r.import_order,
  }));
}

/** Writes a table row and replaces its seats. Call inside a transaction. */
async function saveTable(trx: Executor, table: PlayTable): Promise<void> {
  await trx.updateTable('play_tables').set({
    game_id: table.gameId,
    game_title: table.gameTitle,
    start_hour: table.startHour,
    max_players: table.maxPlayers,
    kind: table.kind,
    owner_user_id: table.ownerUserId,
    taken_slots: table.takenSlots,
  }).where('id', '=', table.id).execute();
  await trx.deleteFrom('table_slots').where('play_table_id', '=', table.id).execute();
  if (table.participants.length > 0) {
    await trx.insertInto('table_slots').values(table.participants.map(p => ({
      play_table_id: table.id, slot_number: p.slotNumber, participant_name: p.participantName, user_id: p.userId,
      is_imported: p.isImported === true ? 1 : 0,
    }))).execute();
  }
}

export const notOwnerError = 'Tylko właściciel stołu lub administrator może go edytować.';

/**
 * Runs an owner's/admin's edit: the table is loaded only if the viewer owns it or is an admin (checked in the
 * query), the rule runs in memory, and the result is saved – all in one transaction.
 */
export async function editManagedTable(
  db: Db, tableId: number, viewer: Viewer, edit: (table: PlayTable, trx: Executor) => Result | Promise<Result>,
): Promise<Result> {
  if (viewer.userId === null) {
    return { ok: false, error: notOwnerError };
  }
  const userId = viewer.userId;
  return db.transaction().execute(async trx => {
    let query = trx.selectFrom('play_tables').select('id').where('id', '=', tableId);
    if (!viewer.isAdmin) {
      query = query.where('owner_user_id', '=', userId);
    }
    if (!(await query.executeTakeFirst())) {
      return { ok: false, error: notOwnerError };
    }
    const table = await loadBoardTable(trx, tableId);
    if (!table) {
      return { ok: false, error: notOwnerError };
    }
    const result = await edit(table, trx);
    if (result.ok) {
      await saveTable(trx, table);
    }
    return result;
  });
}

/** Runs an edit any logged-in user may try (taking a seat): the rule itself decides. One transaction. */
export async function editTable(
  db: Db, tableId: number, edit: (table: BoardTable, trx: Executor) => Result | Promise<Result>,
): Promise<Result> {
  return db.transaction().execute(async trx => {
    const table = await loadBoardTable(trx, tableId);
    if (!table) {
      return { ok: false, error: 'Ten stół już nie istnieje.' };
    }
    const result = await edit(table, trx);
    if (result.ok) {
      await saveTable(trx, table);
    }
    return result;
  });
}

/**
 * Frees a seat. Only the person in it, the table's owner or an admin may – the rule is part of the DELETE's
 * WHERE clause (port of TableSlot.RemovableBy). Returns false when nothing matched (no right, or no such seat).
 */
export async function freeSlot(db: Db, tableId: number, slot: number, viewer: Viewer): Promise<boolean> {
  if (viewer.userId === null) {
    return false;
  }
  const userId = viewer.userId;
  const result = await db.deleteFrom('table_slots')
    .where('play_table_id', '=', tableId)
    .where('slot_number', '=', slot)
    .where(eb => removableBy(eb, userId, viewer.isAdmin))
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

/**
 * Seats a user may free: their own, any seat at a table they own, or any seat for an admin.
 * Used in WHERE clauses on table_slots (exported for the authorization tests).
 */
export function removableBy(eb: ExpressionBuilder<Database, 'table_slots'>, userId: string, isAdmin: boolean) {
  if (isAdmin) {
    return eb.lit(true);
  }
  return eb.or([
    eb('table_slots.user_id', '=', userId),
    eb('table_slots.play_table_id', 'in', eb.selectFrom('play_tables').select('play_tables.id').where('play_tables.owner_user_id', '=', userId)),
  ]);
}

/** Deletes a table if the viewer owns it or is an admin (checked in the query). The game stays in the catalog. */
export async function deleteManagedTable(db: Db, tableId: number, viewer: Viewer): Promise<boolean> {
  if (viewer.userId === null) {
    return false;
  }
  let query = db.deleteFrom('play_tables').where('id', '=', tableId);
  if (!viewer.isAdmin) {
    query = query.where('owner_user_id', '=', viewer.userId);
  }
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

/** Inserts a new table with its seats, and the phrase typed to create it (TablePhrase.For), in one transaction. */
export async function insertTable(db: Db, table: PlayTable, phrase: { text: string; userId: string }): Promise<number> {
  return db.transaction().execute(async trx => {
    const row = await trx.insertInto('play_tables').values({
      game_id: table.gameId,
      game_title: table.gameTitle,
      start_hour: table.startHour,
      max_players: table.maxPlayers,
      kind: table.kind,
      owner_user_id: table.ownerUserId,
      taken_slots: table.takenSlots,
    }).returning('id').executeTakeFirstOrThrow();
    table.id = row.id;
    await saveTable(trx, table);
    // Phrases outlive tables and the weekly reset; the user is stored but never shown.
    await trx.insertInto('table_phrases').values({
      phrase: phrase.text.trim().slice(0, 200), game_id: table.gameId, user_id: phrase.userId, created_utc: new Date().toISOString(),
    }).execute();
    return row.id;
  });
}

/** Action log entry for a user taking a seat themselves (UserActionLog.JoinedTable). Call in the seat's transaction. */
export async function logJoinedTable(trx: Executor, table: BoardTable, slot: number, userId: string, userName: string): Promise<void> {
  const title = table.gameTitle ?? table.game.name;
  await trx.insertInto('user_action_logs').values({
    created_utc: new Date().toISOString(),
    action: 'JoinedTable',
    actor_user_id: userId,
    actor_name: userName,
    target_user_id: null,
    target_name: null,
    play_table_id: table.id,
    details: `${title} – miejsce ${slot}`.slice(0, 500),
  }).execute();
}

/** Registered users for the owner's "add player" popup: id and user name, by name. */
export async function listUsers(db: Db): Promise<{ id: string; userName: string }[]> {
  const rows = await db.selectFrom('users').select(['id', 'user_name']).orderBy('user_name').execute();
  return rows.map(r => ({ id: r.id, userName: r.user_name }));
}
