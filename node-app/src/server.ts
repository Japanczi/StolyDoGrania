// Entry point: `npm start` / `npm run dev`. The bottom half of Program.cs: load config, open the
// database, build the app, listen – and shut down cleanly on Ctrl+C or `systemctl stop`.

import { buildApp } from './app.ts';
import { seedAccounts } from './auth/seed.ts';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { pendingMigrations } from './db/migrator.ts';
import { startSheetImport } from './import/sheet-import-job.ts';
import { startWeeklyReset } from './jobs/weekly-reset.ts';
import { createLiveHub } from './live/hub.ts';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const db = openDatabase(config.databasePath);

// Migrations are applied explicitly (`npm run migrate`, which `npm run dev` runs first), never silently here,
// so a deploy can't change the schema by surprise. Refuse to start against an outdated database.
const pending = await pendingMigrations(db);
if (pending.length > 0) {
  console.error(`Database ${config.databasePath} needs migrations: ${pending.join(', ')}. Run: npm run migrate`);
  await db.destroy();
  process.exit(1);
}

// The live-update hub is shared by the routes and the background jobs (they tell open pages about changes too).
const hub = createLiveHub();
const app = await buildApp({ config, db, hub });

// The Owner account and, in development, the 4 test users (IdentitySeeder.SeedAsync in Program.cs).
await seedAccounts(db, config, app.log);

// Background jobs (AddHostedService in Program.cs): plain timers in this process. See docs/learning/background-jobs.md.
const weeklyReset = startWeeklyReset({ db, hub, log: app.log });
// TEMPORARY: the Google sign-up sheet import (off unless SHEET_IMPORT_ENABLED=true).
const sheetImport = startSheetImport({ db, hub, log: app.log, settings: config.sheetImport });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down`);
  weeklyReset.stop();
  sheetImport.stop();
  await app.close();   // stops accepting requests, lets running ones finish
  await db.destroy();  // closes the SQLite connection
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
