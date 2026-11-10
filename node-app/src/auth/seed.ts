// Accounts created at startup. Port of Data/IdentitySeeder.cs.

import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db/database.ts';
import { createUser, findUserByUserName, setRole } from '../db/queries/users.ts';
import { passwordStrengthErrors } from '../domain/password-policy.ts';
import { hashPassword } from './password-hash.ts';

/** Development only: these accounts have a publicly known password. A mix of short and long names for the UI. */
export const testUserNames = [
  'Jan Nowak',
  'Zofia Wiśniewska',
  'Grzegorz Brzęczyszczykiewicz',
  'Małgorzata Szczepańska-Dąbrowska',
] as const;
export const testUserPassword = 'gracz';

export async function seedAccounts(db: Db, config: Config, log: FastifyBaseLogger): Promise<void> {
  await seedOwner(db, config, log);
  // Checked here on the server, not by hiding anything in the UI (CLAUDE.md).
  if (config.environment === 'development') {
    await seedTestUsers(db, log);
  }
}

/**
 * The account configured as ADMIN_USER_NAME is the main admin (Owner): created if missing, with a confirmed
 * e-mail, and always given the Owner role (which includes Admin).
 */
async function seedOwner(db: Db, config: Config, log: FastifyBaseLogger): Promise<void> {
  const seed = config.adminSeed;
  if (!seed) {
    log.warn('ADMIN_USER_NAME / ADMIN_EMAIL / ADMIN_PASSWORD not set – skipping the Owner account.');
    return;
  }
  const existing = await findUserByUserName(db, seed.userName);
  if (existing) {
    if (existing.role !== 'owner') {
      await setRole(db, existing.id, 'owner');
    }
    return;
  }
  const weak = passwordStrengthErrors(seed.password, config.environment === 'production');
  if (weak.length > 0) {
    log.error(`Could not create the Owner account: ${weak.join(', ')}`);
    return;
  }
  const created = await createUser(db, {
    userName: seed.userName, email: seed.email, passwordHash: await hashPassword(seed.password), emailConfirmed: true, role: 'owner',
  });
  if (!created.ok) {
    log.error(`Could not create the Owner account: ${created.taken} already taken.`);
  }
}

async function seedTestUsers(db: Db, log: FastifyBaseLogger): Promise<void> {
  for (const [i, userName] of testUserNames.entries()) {
    if (await findUserByUserName(db, userName)) {
      continue;
    }
    const created = await createUser(db, {
      userName, email: `gracz${i + 1}@example.com`, passwordHash: await hashPassword(testUserPassword), emailConfirmed: true, role: 'user',
    });
    if (!created.ok) {
      log.error(`Could not create test user ${userName}: ${created.taken} already taken.`);
    }
  }
}
