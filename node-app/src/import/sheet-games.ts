// TEMPORARY – the Google sign-up sheet import (see sheet-import-job.ts).
// Finds the sheet's games on BGG and adds them to the catalog (details + cover), before the sync. Runs outside the
// sync's transaction on purpose: BGG allows one request per 5 seconds, and a transaction held that long would block
// every other write in the app (SQLite has one writer).

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/database.ts';
import { findBggGamesByAnyName, type CatalogGame } from '../db/queries/games.ts';
import { addBggGameToCatalog } from '../integrations/bgg/add-to-catalog.ts';
import { BggUnavailableError, type BggClient, type BggSearchResult } from '../integrations/bgg/client.ts';
import { normalizeTitle, type SheetTableRow } from './sheet-parser.ts';

/**
 * What a BGG name search found per normalized title (null = no single clear match), so a title is searched once
 * per server run instead of at every import. Titles with a BGG link in the sheet don't need it.
 */
export type BggSearchCache = Map<string, number | null>;

export type SheetGamesDeps = {
  db: Db;
  bgg: BggClient;
  log: Pick<FastifyBaseLogger, 'warn'>;
  cache: BggSearchCache;
};

/**
 * Normalized title → catalog id of its BGG game, for every distinct title of the sheet that could be matched:
 * by the sheet's BGG link when there is one, otherwise by the catalog's BGG games, otherwise by one clear BGG search
 * result (the same rule as the new-table row). Titles without a match are left out (the sync then uses a catalog
 * game of that name, or adds a sheet-only game, as before). Never throws: a failure only means fewer matches.
 */
export async function findSheetGamesOnBgg(
  deps: SheetGamesDeps, rows: readonly SheetTableRow[], links: ReadonlyMap<string, number>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!deps.bgg.isConfigured) {
    return result;
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const title = normalizeTitle(row.title);
    if (seen.has(title)) continue;
    seen.add(title);
    try {
      const game = await findGame(deps, row, title, links.get(title) ?? null);
      if (game) result.set(title, game.id);
    } catch (err) {
      if (err instanceof BggUnavailableError) {
        // BGG is down or refusing: the remaining titles would fail too. The next import tries again.
        deps.log.warn({ err }, 'Sign-up sheet import: BGG is unavailable, the remaining games are matched by name only.');
        break;
      }
      deps.log.warn({ err }, `Sign-up sheet import: matching "${row.title}" with BGG failed.`);
    }
  }
  return result;
}

async function findGame(deps: SheetGamesDeps, row: SheetTableRow, title: string, linkedId: number | null): Promise<CatalogGame | null> {
  if (linkedId !== null) {
    return addBggGameToCatalog(deps.db, deps.bgg, linkedId, row.kind);
  }
  // Already in the catalog with BGG data under this name (or an alternate name): BGG isn't asked.
  const matches = await findBggGamesByAnyName(deps.db, row.title);
  if (matches.length > 0) {
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }
  let bggId = deps.cache.get(title);
  if (bggId === undefined) {
    bggId = clearMatch(row.title, await deps.bgg.search(row.title));
    deps.cache.set(title, bggId);
  }
  return bggId === null ? null : addBggGameToCatalog(deps.db, deps.bgg, bggId, row.kind);
}

/** The one exact title match, or the only result; null when BGG found nothing or several possible games. */
export function clearMatch(title: string, results: readonly BggSearchResult[]): number | null {
  const lower = title.trim().toLowerCase();
  const exact = results.filter(r => r.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0]?.id ?? null;
  if (exact.length === 0 && results.length === 1) return results[0]?.id ?? null;
  return null;
}
