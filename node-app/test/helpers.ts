// Shared test setup: a fresh in-memory database with every migration applied, and an app built on it.

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, type Db } from '../src/db/database.ts';
import { migrateToLatest } from '../src/db/migrator.ts';

export const testConfig: Config = {
  environment: 'test',
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  logLevel: 'silent',
};

export async function createTestDb(): Promise<Db> {
  const db = openDatabase(':memory:');
  await migrateToLatest(db);
  return db;
}

/** Builds the app on a fresh database. Call `close()` in `after`/`t.after` to release both. */
export async function createTestApp(config: Partial<Config> = {}): Promise<{ app: FastifyInstance; db: Db; close: () => Promise<void> }> {
  const db = await createTestDb();
  const app = await buildApp({ config: { ...testConfig, ...config }, db });
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}
