// Runs migrations with Kysely's Migrator. It records each applied migration in the table `kysely_migration`
// (the counterpart of EF Core's `__EFMigrationsHistory`) and runs the missing ones in name order.

import { Migrator } from 'kysely/migration';
import type { Db } from './database.ts';
import { migrations } from './migrations/index.ts';

function createMigrator(db: Db): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
}

/** Applies every pending migration (like `dotnet ef database update`). Returns the names it applied. */
export async function migrateToLatest(db: Db): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) {
    const failed = results?.find(r => r.status === 'Error')?.migrationName ?? '(unknown)';
    throw new Error(`Migration ${failed} failed.`, { cause: error });
  }
  return (results ?? []).filter(r => r.status === 'Success').map(r => r.migrationName);
}

/** Names of migrations not yet applied to this database. */
export async function pendingMigrations(db: Db): Promise<string[]> {
  const all = await createMigrator(db).getMigrations();
  return all.filter(m => m.executedAt === undefined).map(m => m.name);
}
