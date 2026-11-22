// Adds a BGG game to our catalog: details + cover from BGG, saved once (later lookups read the catalog).
// Shared by the board's game lookup (web/pages/board/lookup.ts) and the TEMPORARY sheet import (src/import/).

import type { Db } from '../../db/database.ts';
import { findGameByBggId, saveBggGame, type CatalogGame } from '../../db/queries/games.ts';
import type { TableKind } from '../../domain/play-table.ts';
import type { BggClient } from './client.ts';

/**
 * Returns the catalog game for this BGG id, fetching it from BGG first unless it's already saved with a cover
 * (no cover = the download failed last time, so it's tried again). Null when BGG has no item with this id.
 * `kind` is the table kind given to a game new to the catalog. Throws BggUnavailableError when BGG can't be reached.
 */
export async function addBggGameToCatalog(db: Db, bgg: BggClient, bggId: number, kind: TableKind): Promise<CatalogGame | null> {
  const cached = await findGameByBggId(db, bggId);
  if (cached?.hasCover) {
    return cached;
  }
  const details = await bgg.getGame(bggId);
  if (!details) {
    return null;
  }
  const cover = details.thumbnailUrl ? await bgg.downloadCover(details.thumbnailUrl) : null;
  await saveBggGame(db, details, cover, kind);
  return findGameByBggId(db, bggId);
}
