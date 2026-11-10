// TEMPORARY – imports the Google sign-up sheet ("Zapisy") into the list of tables at startup and then every
// `intervalMinutes` minutes (30 by default). Port of Data/Import/SheetImportService.cs (a BackgroundService).
// A failed or unreadable download changes nothing, so a broken sheet never empties the board; the next check
// tries again.
//
// Only bridges the move from the sheet to the app. Everything lives in src/import/ and nothing else depends on it,
// so removing it = delete this folder + its test, the startSheetImport call in the server, the SHEET_IMPORT_*
// settings, the "imported" divider in the board view, and add a migration dropping the 0004-sheet-import columns.

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/database.ts';
import type { LiveHub } from '../live/hub.ts';
import { syncSheet, type SheetSyncResult } from './board-sync.ts';
import { parseSheet } from './sheet-parser.ts';

export type SheetImportSettings = {
  enabled: boolean;
  /**
   * The sheet's public Google Visualization feed in JSON, e.g.
   * https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:json&headers=1&sheet=Zapisy.
   * The feed picks the tab by name (it ignores gid), so renaming the tab needs this updated.
   */
  sourceUrl: string;
  intervalMinutes: number;
};

export type SheetImportDeps = {
  db: Db;
  hub: Pick<LiveHub, 'notify'>;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  settings: SheetImportSettings;
  /** Injectable for tests; the global fetch otherwise. */
  fetch?: typeof fetch;
};

/** Download timeout (the .NET app's named HttpClient had 30 s). */
const downloadTimeoutMs = 30_000;

/** One import: download, parse, sync in one transaction, tell open pages. Throws when the download or parse fails. */
export async function importSheet(deps: SheetImportDeps): Promise<SheetSyncResult> {
  const fetchFn = deps.fetch ?? fetch;
  const response = await fetchFn(deps.settings.sourceUrl, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok) {
    throw new Error(`The sheet download answered HTTP ${response.status}.`);
  }
  const rows = parseSheet(await response.text());
  const result = await syncSheet(deps.db, rows);

  deps.log.info(`Sign-up sheet import: ${result.added} tables added, ${result.updated} checked, ${result.removed} removed.`);
  if (result.droppedPlayers.length > 0) {
    deps.log.warn(`Sign-up sheet import: no seat left for app players ${result.droppedPlayers.join(', ')}.`);
  }
  if (result.changed) {
    deps.hub.notify({ tableId: null });
  }
  return result;
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
  const run = (): Promise<void> => {
    // A check that comes while the previous one is still running is skipped (no overlapping imports).
    if (current) return current;
    current = (async () => {
      try {
        await importSheet(deps);
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
