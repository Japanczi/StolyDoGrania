// Command-line entry: `npm run migrate` applies pending migrations to the configured database.

import { loadConfig } from '../config.ts';
import { openDatabase } from './database.ts';
import { migrateToLatest } from './migrator.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const applied = await migrateToLatest(db);
  console.log(applied.length === 0
    ? `Database ${config.databasePath} is up to date.`
    : `Applied to ${config.databasePath}: ${applied.join(', ')}`);
} finally {
  await db.destroy();
}
