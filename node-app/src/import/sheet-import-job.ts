// TEMPORARY – imports the Google sign-up sheet ("Zapisy") into the list of tables at startup and then every
// `intervalMinutes` minutes (60 by default). Port of Data/Import/SheetImportService.cs (a BackgroundService).
// A failed or unreadable download changes nothing, so a broken sheet never empties the board; the next check
// tries again.
//
// Only bridges the move from the sheet to the app. Everything lives in src/import/ and nothing else depends on it,
// so removing it = delete this folder + its test, the startSheetImport call in the server, the SHEET_IMPORT_*
// settings, the "imported" divider in the board view, and add a migration dropping the 0004-sheet-import columns.

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/database.ts';
import type { LiveHub } from '../live/hub.ts';
import type { BggClient } from '../integrations/bgg/client.ts';
import { syncSheet, type SheetSyncResult } from './board-sync.ts';
import { findSheetGamesOnBgg, type BggSearchCache } from './sheet-games.ts';
import { parseSheetLinks } from './sheet-links.ts';
import { parseSheet } from './sheet-parser.ts';

export type SheetImportSettings = {
  enabled: boolean;
  /**
   * The sheet's public Google Visualization feed in JSON, e.g.
   * https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:json&headers=1&sheet=Zapisy.
   * The feed picks the tab by name (it ignores gid), so renaming the tab needs this updated.
   */
  sourceUrl: string;
  /**
   * The same tab's public HTML view, read only for its BGG links (see sheet-links.ts), e.g.
   * https://docs.google.com/spreadsheets/d/{id}/htmlview/sheet?headers=true&gid=0 ('' = no links: names only).
   */
  linksUrl: string;
  intervalMinutes: number;
};

export type SheetImportDeps = {
  db: Db;
  hub: Pick<LiveHub, 'notify'>;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  settings: SheetImportSettings;
  /**
   * Finds the sheet's games on BGG (sheet-games.ts). The app's one client, shared with the board's lookups, so its
   * 5-second spacing covers both. Without it (or without BGG_TOKEN), games are matched by name only.
   */
  bgg?: BggClient;
  /** Injectable for tests; the global fetch otherwise. */
  fetch?: typeof fetch;
};

/** Download timeout (the .NET app's named HttpClient had 30 s). */
const downloadTimeoutMs = 30_000;

/**
 * One import: download and parse the sheet, find its games on BGG (outside the transaction), sync in one
 * transaction, tell open pages. Throws when the sheet's download or parse fails.
 */
export async function importSheet(deps: SheetImportDeps, searchCache: BggSearchCache = new Map()): Promise<SheetSyncResult> {
  const fetchFn = deps.fetch ?? fetch;
  const response = await fetchFn(deps.settings.sourceUrl, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok) {
    throw new Error(`The sheet download answered HTTP ${response.status}.`);
  }
  const rows = parseSheet(await response.text());
  const bggGames = deps.bgg?.isConfigured
    ? await findSheetGamesOnBgg({ db: deps.db, bgg: deps.bgg, log: deps.log, cache: searchCache }, rows, await downloadLinks(deps, fetchFn))
    : new Map<string, number>();
  const result = await syncSheet(deps.db, rows, bggGames);

  deps.log.info(`Sign-up sheet import: ${result.added} tables added, ${result.updated} checked, ${result.removed} removed, `
    + `${bggGames.size} games matched on BGG.`);
  if (result.droppedPlayers.length > 0) {
    deps.log.warn(`Sign-up sheet import: no seat left for app players ${result.droppedPlayers.join(', ')}.`);
  }
  if (result.changed) {
    deps.hub.notify({ tableId: null });
  }
  return result;
}

/** The sheet's BGG links; any failure only means no links this time (logged), never a failed import. */
async function downloadLinks(deps: SheetImportDeps, fetchFn: typeof fetch): Promise<Map<string, number>> {
  if (deps.settings.linksUrl.trim() === '') {
    return new Map();
  }
  try {
    const response = await fetchFn(deps.settings.linksUrl, { signal: AbortSignal.timeout(downloadTimeoutMs) });
    if (!response.ok) {
      throw new Error(`The sheet's HTML view answered HTTP ${response.status}.`);
    }
    return parseSheetLinks(await response.text());
  } catch (err) {
    deps.log.warn({ err }, 'Sign-up sheet import: the BGG links could not be read; games are searched on BGG by name.');
    return new Map();
  }
}

export type SheetImportJob = {
  stop(): void;
  /** Runs an import now, or returns the one already running (runs never overlap). For tests. */
  runNow(): Promise<void>;
};

export function startSheetImport(deps: SheetImportDeps): SheetImportJob {
  const { settings } = deps;
  if (!settings.enabled || settings.sourceUrl.trim() === '') {
    deps.log.info('Sign-up sheet import is off (SHEET_IMPORT_ENABLED / SHEET_IMPORT_URL).');
    return { stop() {}, runNow: () => Promise.resolve() };
  }

  let current: Promise<void> | null = null;
  // Kept for the life of the server, so a title is searched on BGG once, not at every import.
  const searchCache: BggSearchCache = new Map();
  const run = (): Promise<void> => {
    // A check that comes while the previous one is still running is skipped (no overlapping imports).
    if (current) return current;
    current = (async () => {
      try {
        await importSheet(deps, searchCache);
      } catch (err) {
        // Logged, not thrown: an unhandled rejection would stop the whole server.
        deps.log.error({ err }, 'Sign-up sheet import failed; it will be retried at the next check.');
      }
    })().finally(() => {
      current = null;
    });
    return current;
  };

  void run();
  const timer = setInterval(() => void run(), Math.max(1, settings.intervalMinutes) * 60_000);
  return {
    stop: () => clearInterval(timer),
    runNow: run,
  };
}
