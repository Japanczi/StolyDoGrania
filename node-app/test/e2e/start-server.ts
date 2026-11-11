// Started by Playwright (playwright.config.ts): a fresh e2e database, migrated, then the normal server.

import { rmSync } from 'node:fs';
import { loadConfig } from '../../src/config.ts';
import { openDatabase } from '../../src/db/database.ts';
import { migrateToLatest } from '../../src/db/migrator.ts';

const config = loadConfig();
if (!config.databasePath.endsWith('e2e.db')) {
  throw new Error('Refusing to delete a database that is not the e2e one.');
}
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${config.databasePath}${suffix}`, { force: true });
}
const db = openDatabase(config.databasePath);
await migrateToLatest(db);
await db.destroy();
await import('../../src/server.ts');
