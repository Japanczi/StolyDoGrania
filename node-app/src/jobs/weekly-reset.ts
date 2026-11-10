// Clears the board every Monday at midnight (Europe/Warsaw) while the admin toolbox's "Auto" switch is on.
// Port of Data/Table/WeeklyBoardResetService.cs (a BackgroundService with a PeriodicTimer).
//
// Node has no hosted-service base class: this is a plain function that checks once right away (catching up on a
// Monday missed while the app was down) and then every minute with setInterval. A `running` flag prevents
// overlapping checks; `stop()` is called on shutdown. See docs/learning/background-jobs.md.

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/database.ts';
import { clearTables, getAutoReset, saveAutoReset } from '../db/queries/board-settings.ts';
import { isAutoResetDue } from '../domain/board-settings.ts';
import type { LiveHub } from '../live/hub.ts';

export type WeeklyResetDeps = {
  db: Db;
  hub: LiveHub;
  log: FastifyBaseLogger;
  /** Injectable clock for tests. */
  now?: () => Date;
  intervalMs?: number;
};

/** One check: if a reset is due, clear the board and record it – in one transaction. Returns the tables removed, or null. */
export async function resetIfDue(deps: Pick<WeeklyResetDeps, 'db' | 'hub' | 'now'>): Promise<number | null> {
  const now = deps.now?.() ?? new Date();
  const removed = await deps.db.transaction().execute(async trx => {
    const settings = await getAutoReset(trx);
    if (!isAutoResetDue(settings, now)) {
      return null;
    }
    // One transaction, so a reset is never recorded without having happened, or the other way round.
    const count = await clearTables(trx);
    await saveAutoReset(trx, { ...settings, checkedUtc: now });
    return count;
  });
  if (removed !== null) {
    deps.hub.notify({ tableId: null });
  }
  return removed;
}

export function startWeeklyReset(deps: WeeklyResetDeps): { stop(): void } {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const removed = await resetIfDue(deps);
      if (removed !== null) {
        deps.log.info(`Weekly reset: removed ${removed} tables.`);
      }
    } catch (err) {
      // Logged, not thrown: an unhandled rejection would stop the whole server. Retried at the next check.
      deps.log.error({ err }, 'The weekly reset of the list of tables failed; it will be retried at the next check.');
    } finally {
      running = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), deps.intervalMs ?? 60_000);
  return { stop: () => clearInterval(timer) };
}
