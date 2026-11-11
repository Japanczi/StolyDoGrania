// Reads and writes of the games catalog. Port of the catalog parts of Tables.razor (SaveBggGameAsync,
// FindInCatalog …) and of Game.ApplyBggData.

import { sql, type Kysely } from 'kysely';
import type { BggCover, BggGameDetails } from '../../integrations/bgg/client.ts';
import { defaultBggUrl, isMissingCover, uniqueCatalogName } from '../../domain/game.ts';
import type { TableKind } from '../../domain/play-table.ts';
import type { Database } from '../schema.ts';

type Executor = Kysely<Database>;

/** What the lookup and the new-table form need to know about a catalog game. */
export type CatalogGame = {
  id: number;
  name: string;
  kind: TableKind;
  weight: string;
  maxPlayers: number;
  bggId: number | null;
  year: number | null;
  hasCover: boolean;
};

const columns = ['id', 'name', 'kind', 'weight', 'max_players', 'bgg_id', 'year_published', 'cover_type'] as const;

function toCatalogGame(r: {
  id: number; name: string; kind: TableKind; weight: string; max_players: number; bgg_id: number | null; year_published: number | null; cover_type: string | null;
}): CatalogGame {
  return {
    id: r.id, name: r.name, kind: r.kind, weight: r.weight, maxPlayers: r.max_players, bggId: r.bgg_id,
    year: r.year_published, hasCover: !isMissingCover(r.cover_type),
  };
}

export async function findGameById(db: Executor, id: number): Promise<CatalogGame | null> {
  const row = await db.selectFrom('games').select(columns).where('id', '=', id).executeTakeFirst();
  return row ? toCatalogGame(row) : null;
}

/** By catalog name, case-insensitively (the column is COLLATE NOCASE). */
export async function findGameByName(db: Executor, name: string): Promise<CatalogGame | null> {
  const row = await db.selectFrom('games').select(columns).where('name', '=', name.trim()).executeTakeFirst();
  return row ? toCatalogGame(row) : null;
}

export async function findGameByBggId(db: Executor, bggId: number): Promise<CatalogGame | null> {
  const row = await db.selectFrom('games').select(columns).where('bgg_id', '=', bggId).executeTakeFirst();
  return row ? toCatalogGame(row) : null;
}

/** BGG games in the catalog whose name or an alternate name equals `name` (case-insensitive). */
export async function findBggGamesByAnyName(db: Executor, name: string): Promise<CatalogGame[]> {
  const trimmed = name.trim();
  const rows = await db.selectFrom('games').select(columns)
    .where('bgg_id', 'is not', null)
    .where(eb => eb.or([
      eb('name', '=', trimmed),
      eb('id', 'in', eb.selectFrom('game_alternate_names').select('game_id').where('name', '=', trimmed)),
    ]))
    .orderBy('name')
    .execute();
  return rows.map(toCatalogGame);
}

/** A game added by hand (no BGG id) with exactly this name, if any – the fallback when BGG has nothing. */
export async function findHandAddedGame(db: Executor, name: string): Promise<CatalogGame | null> {
  const row = await db.selectFrom('games').select(columns).where('name', '=', name.trim()).where('bgg_id', 'is', null).executeTakeFirst();
  return row ? toCatalogGame(row) : null;
}

/** Every catalog name and alternate name, for the game-name field's suggestions (<datalist>). */
export async function catalogNames(db: Executor): Promise<string[]> {
  const rows = await sql<{ name: string }>`
    select name from games union select name from game_alternate_names order by name collate nocase`.execute(db);
  return rows.rows.map(r => r.name);
}

export async function getCover(db: Executor, gameId: number): Promise<{ bytes: Buffer; type: string } | null> {
  const row = await db.selectFrom('games').select(['cover', 'cover_type']).where('id', '=', gameId).executeTakeFirst();
  return row?.cover && row.cover_type ? { bytes: row.cover, type: row.cover_type } : null;
}

export type NewHandAddedGame = { name: string; kind: TableKind; maxPlayers: number; cover: BggCover | null };

/** Adds a game that isn't on BGG (or wasn't chosen from it). Its link points at BGG's home page. */
export async function insertHandAddedGame(db: Executor, game: NewHandAddedGame): Promise<number> {
  const row = await db.insertInto('games').values({
    name: game.name.trim(),
    kind: game.kind,
    weight: '0',
    max_players: game.maxPlayers,
    bgg_url: defaultBggUrl,
    bgg_id: null,
    year_published: null,
    cover: game.cover?.bytes ?? null,
    cover_type: game.cover?.contentType ?? null,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

/** Stores an uploaded cover, but only where Game.CanUploadCover allows it (no BGG id, no cover yet). */
export async function setUploadedCover(db: Executor, gameId: number, cover: BggCover): Promise<boolean> {
  const result = await db.updateTable('games')
    .set({ cover: cover.bytes, cover_type: cover.contentType })
    .where('id', '=', gameId)
    .where('bgg_id', 'is', null)
    .where(eb => eb.or([eb('cover_type', 'is', null), eb('cover_type', '=', 'image/svg+xml')]))
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/**
 * Saves a game from BGG into the catalog, so BGG (and its cover) is contacted only once per game.
 * BGG takes priority: a game added by hand under one of BGG's titles becomes that BGG game, cover included.
 * Port of SaveBggGameAsync + Game.ApplyBggData. Returns the catalog id.
 */
export async function saveBggGame(db: Kysely<Database>, details: BggGameDetails, cover: BggCover | null, kind: TableKind): Promise<number> {
  return db.transaction().execute(async trx => {
    const existing = await findGameByBggId(trx, details.id);
    const handAdded = existing ? null : await findHandAddedMatch(trx, details);
    const isTaken = async (name: string, ignoredId: number | null) => {
      const taken = await findGameByName(trx, name);
      return taken !== null && taken.id !== ignoredId;
    };
    // uniqueCatalogName is synchronous, so the (at most two) candidate names are checked first.
    const nameFor = async (ignoredId: number | null) => {
      const options = details.year !== null ? [details.name, `${details.name} (${details.year})`] : [details.name];
      const takenSet = new Set<string>();
      for (const option of options) {
        if (await isTaken(option, ignoredId)) takenSet.add(option);
      }
      return uniqueCatalogName(details.name, details.year, details.id, n => takenSet.has(n));
    };

    let gameId: number;
    let wasHandAdded: boolean;
    let hadCover: boolean;
    if (existing) {
      gameId = existing.id;
      wasHandAdded = false;
      hadCover = existing.hasCover;
    } else if (handAdded) {
      gameId = handAdded.id;
      wasHandAdded = true;
      hadCover = handAdded.hasCover;
      await trx.updateTable('games').set({ name: await nameFor(handAdded.id) }).where('id', '=', gameId).execute();
    } else {
      gameId = (await trx.insertInto('games').values({
        name: await nameFor(null), kind, weight: '0', max_players: details.maxPlayers, bgg_url: null, bgg_id: null,
        year_published: null, cover: null, cover_type: null,
      }).returning('id').executeTakeFirstOrThrow()).id;
      wasHandAdded = true;
      hadCover = false;
    }

    // BGG's data, unmodified, as BGG's terms require. A cover that already came from BGG is kept.
    const replaceCover = cover !== null && (wasHandAdded || !hadCover);
    await trx.updateTable('games').set({
      bgg_id: details.id,
      bgg_url: `https://boardgamegeek.com/boardgame/${details.id}`,
      year_published: details.year,
      weight: details.weight,
      max_players: details.maxPlayers,
      ...(replaceCover ? { cover: cover.bytes, cover_type: cover.contentType } : {}),
    }).where('id', '=', gameId).execute();

    // Alternate names synced to BGG's list.
    await trx.deleteFrom('game_alternate_names').where('game_id', '=', gameId).execute();
    const names = [...new Map(details.alternateNames.map(n => [n.toLowerCase(), n])).values()];
    if (names.length > 0) {
      await trx.insertInto('game_alternate_names').values(names.map(name => ({ game_id: gameId, name }))).execute();
    }
    return gameId;
  });
}

async function findHandAddedMatch(db: Executor, details: BggGameDetails): Promise<CatalogGame | null> {
  for (const name of [details.name, ...details.alternateNames]) {
    const match = await findHandAddedGame(db, name);
    if (match) {
      return match;
    }
  }
  return null;
}
