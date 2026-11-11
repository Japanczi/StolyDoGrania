// Reads and writes of the users table. The counterpart of Identity's UserManager / UserStore.

import type { Selectable } from 'kysely';
import { newUserId } from '../../auth/random.ts';
import { normalizeKey, shortName } from '../../domain/user-name.ts';
import type { Db } from '../database.ts';
import type { Role, UsersTable } from '../schema.ts';

export type User = Selectable<UsersTable>;

export async function findUserById(db: Db, id: string): Promise<User | undefined> {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  return db.selectFrom('users').selectAll().where('normalized_email', '=', normalizeKey(email.trim())).executeTakeFirst();
}

export async function findUserByUserName(db: Db, userName: string): Promise<User | undefined> {
  return db.selectFrom('users').selectAll().where('normalized_user_name', '=', normalizeKey(userName.trim())).executeTakeFirst();
}

/** Login accepts either: user names can't contain '@', so anything with '@' is looked up as an e-mail. */
export async function findUserByLogin(db: Db, login: string): Promise<User | undefined> {
  return login.includes('@') ? findUserByEmail(db, login) : findUserByUserName(db, login);
}

export type NewUser = {
  userName: string;
  email: string;
  passwordHash: string;
  emailConfirmed: boolean;
  role: Role;
};

/** Which unique value is already taken, so the page can say so in Polish. */
export type CreateUserResult = { ok: true; user: User } | { ok: false; taken: 'user-name' | 'email' };

/**
 * Creates an account. Uniqueness is checked first for a friendly message, and enforced again by the
 * database's UNIQUE constraints in case two registrations race.
 */
export async function createUser(db: Db, input: NewUser, now: Date = new Date()): Promise<CreateUserResult> {
  if (await findUserByUserName(db, input.userName)) {
    return { ok: false, taken: 'user-name' };
  }
  if (await findUserByEmail(db, input.email)) {
    return { ok: false, taken: 'email' };
  }
  const user: User = {
    id: newUserId(),
    user_name: input.userName,
    normalized_user_name: normalizeKey(input.userName),
    email: input.email,
    normalized_email: normalizeKey(input.email),
    email_confirmed: input.emailConfirmed ? 1 : 0,
    password_hash: input.passwordHash,
    phone_number: null,
    role: input.role,
    access_failed_count: 0,
    lockout_end_utc: null,
    created_utc: now.toISOString(),
  };
  try {
    await db.insertInto('users').values(user).execute();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, taken: String(err).includes('email') ? 'email' : 'user-name' };
    }
    throw err;
  }
  return { ok: true, user };
}

export async function setPasswordHash(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.updateTable('users').set({ password_hash: passwordHash }).where('id', '=', userId).execute();
}

export async function confirmEmail(db: Db, userId: string): Promise<void> {
  await db.updateTable('users').set({ email_confirmed: 1 }).where('id', '=', userId).execute();
}

/**
 * Changes the e-mail (already confirmed by the link). Older accounts whose user name *is* their e-mail keep both
 * in sync, as in Account/ConfirmEmailChange.razor. Returns false when the address is taken by someone else.
 */
export async function changeEmail(db: Db, user: User, newEmail: string): Promise<boolean> {
  const owner = await findUserByEmail(db, newEmail);
  if (owner && owner.id !== user.id) {
    return false;
  }
  const userNameIsEmail = user.normalized_user_name === user.normalized_email;
  try {
    await db.updateTable('users')
      .set({
        email: newEmail,
        normalized_email: normalizeKey(newEmail),
        email_confirmed: 1,
        ...(userNameIsEmail ? { user_name: newEmail, normalized_user_name: normalizeKey(newEmail) } : {}),
      })
      .where('id', '=', user.id)
      .execute();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return false;
    }
    throw err;
  }
  return true;
}

export async function setPhoneNumber(db: Db, userId: string, phoneNumber: string | null): Promise<void> {
  await db.updateTable('users').set({ phone_number: phoneNumber }).where('id', '=', userId).execute();
}

/**
 * Changes a user name (already normalised and validated). The seats the user holds show the new name too – seat
 * names are copied when a seat is taken, so they're updated here in the same transaction.
 * Returns false when the name is taken by another account (case-insensitively). Call inside the caller's
 * transaction, so the change and its action-log entry are saved together.
 */
export async function setUserName(db: Db, userId: string, userName: string, seatName: string): Promise<boolean> {
  const owner = await findUserByUserName(db, userName);
  if (owner && owner.id !== userId) {
    return false;
  }
  await db.updateTable('users')
    .set({ user_name: userName, normalized_user_name: normalizeKey(userName) })
    .where('id', '=', userId)
    .execute();
  await db.updateTable('table_slots').set({ participant_name: seatName }).where('user_id', '=', userId).execute();
  return true;
}

/**
 * Renames a user and logs it (UserRenamed, "old → new") in one transaction; their seats show the new name.
 * Used by the admin users page and by the profile page (own name). `newName` must already be validated and
 * normalised. Returns false when another account has the name (checked first, and by the UNIQUE index for races).
 */
export async function renameUser(
  db: Db, target: Pick<User, 'id' | 'user_name'>, newName: string, actor: Pick<User, 'id' | 'user_name'>,
): Promise<boolean> {
  try {
    return await db.transaction().execute(async trx => {
      if (!(await setUserName(trx, target.id, newName, shortName(newName)))) return false;
      await trx.insertInto('user_action_logs').values({
        created_utc: new Date().toISOString(), action: 'UserRenamed', actor_user_id: actor.id,
        // An own rename is logged under the new name, as the target is.
        actor_name: actor.id === target.id ? newName : actor.user_name,
        target_user_id: target.id, target_name: newName, play_table_id: null, details: `${target.user_name} → ${newName}`,
      }).execute();
      return true;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export async function setRole(db: Db, userId: string, role: Role): Promise<void> {
  await db.updateTable('users').set({ role }).where('id', '=', userId).execute();
}

/** Deletes the account; its sessions and tokens go with it (ON DELETE CASCADE). */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.deleteFrom('users').where('id', '=', userId).execute();
}

/** SQLite reports a UNIQUE violation with this error code (better-sqlite3 puts it on err.code). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
