// Queries of the "Baza gier" page: the whole catalog with table counts, and deleting a game.

import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.ts';
import type { TableKind } from '../../domain/play-table.ts';

export type CatalogRow = {
  id: number;
  name: string;
  kind: TableKind;
  maxPlayers: number;
  /** BGG weight as stored (text). */
  weight: string;
  bggId: number | null;
  bggUrl: string | null;
  year: number | null;
  coverType: string | null;
  tableCount: number;
  /** Not shown, but searched. */
  alternateNames: string[];
};

/** Every catalog game with the number of tables using it and its alternate names (no cover bytes). */
export async function loadCatalog(db: Kysely<Database>): Promise<CatalogRow[]> {
  const [games, counts, alternates] = await Promise.all([
    db.selectFrom('games')
      .select(['id', 'name', 'kind', 'max_players', 'weight', 'bgg_id', 'bgg_url', 'year_published', 'cover_type'])
      .orderBy('name').execute(),
    db.selectFrom('play_tables').select(['game_id', sql<number>`count(*)`.as('n')]).groupBy('game_id').execute(),
    db.selectFrom('game_alternate_names').select(['game_id', 'name']).execute(),
  ]);
  const tableCounts = new Map(counts.map(c => [c.game_id, Number(c.n)]));
  const names = new Map<number, string[]>();
  for (const a of alternates) {
    const list = names.get(a.game_id) ?? [];
    list.push(a.name);
    names.set(a.game_id, list);
  }
  return games.map(g => ({
    id: g.id, name: g.name, kind: g.kind, maxPlayers: g.max_players, weight: g.weight, bggId: g.bgg_id, bggUrl: g.bgg_url,
    year: g.year_published, coverType: g.cover_type, tableCount: tableCounts.get(g.id) ?? 0, alternateNames: names.get(g.id) ?? [],
  }));
}

export type DeleteGameResult = { result: 'deleted'; name: string } | { result: 'missing' } | { result: 'in-use'; name: string };

/**
 * Deletes a game unless a table uses it (the database refuses too: ON DELETE RESTRICT on play_tables.game_id).
 * Alternate names go with the game (cascade). The caller has already checked that the viewer is an admin.
 */
export async function deleteGameIfUnused(db: Kysely<Database>, gameId: number): Promise<DeleteGameResult> {
  try {
    return await db.transaction().execute(async (trx): Promise<DeleteGameResult> => {
      const game = await trx.selectFrom('games').select(['id', 'name']).where('id', '=', gameId).executeTakeFirst();
      if (!game) return { result: 'missing' };
      const used = await trx.selectFrom('play_tables').select('id').where('game_id', '=', gameId).executeTakeFirst();
      if (used) return { result: 'in-use', name: game.name };
      await trx.deleteFrom('games').where('id', '=', gameId).execute();
      return { result: 'deleted', name: game.name };
    });
  } catch (err) {
    // Someone created a table for the game between the check and the delete: the foreign key said no.
    if (typeof err === 'object' && err !== null && 'code' in err && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      const game = await db.selectFrom('games').select('name').where('id', '=', gameId).executeTakeFirst();
      return game ? { result: 'in-use', name: game.name } : { result: 'missing' };
    }
    throw err;
  }
}
