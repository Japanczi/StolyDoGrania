// Makes a consistent copy of a SQLite database that may be in use (SQLite's online backup API), e.g. the live
// .NET app.db before converting it. Copying the file with `cp` while the app writes could catch it half-written.
// Usage: node scripts/backup-sqlite.ts <database> <backup file>

import { existsSync } from 'node:fs';
import SqliteDatabase from 'better-sqlite3';

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('Usage: node scripts/backup-sqlite.ts <database> <backup file>');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`Not found: ${source}`);
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`Backup target already exists, refusing to overwrite: ${target}`);
  process.exit(1);
}
const db = new SqliteDatabase(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
  console.log(`Backed up ${source} to ${target}`);
} finally {
  db.close();
}
