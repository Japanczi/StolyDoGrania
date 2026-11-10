// Accounts: users, login sessions and one-time tokens (e-mail confirmation, e-mail change, password reset).
// Replaces ASP.NET Identity's AspNetUsers / AspNetRoles / AspNetUserRoles / AspNetUserTokens with three tables
// holding only what this app uses. Ids of existing users are kept by the migration script (phase 4).

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    // GUID strings, as Identity generated them, so existing ids carry over unchanged.
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('user_name', 'text', col => col.notNull())
    // Upper-cased copies for case-insensitive lookups and uniqueness (Identity's Normalized* columns).
    .addColumn('normalized_user_name', 'text', col => col.notNull().unique())
    .addColumn('email', 'text', col => col.notNull())
    .addColumn('normalized_email', 'text', col => col.notNull().unique())
    .addColumn('email_confirmed', 'integer', col => col.notNull().defaultTo(0).check(sql`email_confirmed in (0, 1)`))
    // Null only for accounts without a password (none today; kept so "set password" stays possible).
    .addColumn('password_hash', 'text')
    .addColumn('phone_number', 'text')
    // One role per user instead of Identity's role tables: owner (always also an admin), admin or user.
    .addColumn('role', 'text', col => col.notNull().defaultTo('user').check(sql`role in ('owner', 'admin', 'user')`))
    .addColumn('access_failed_count', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('lockout_end_utc', 'text')
    .addColumn('created_utc', 'text', col => col.notNull())
    .execute();

  await db.schema
    .createTable('sessions')
    // SHA-256 of the random id in the cookie: a copy of the database can't be used to log in.
    .addColumn('id_hash', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    // 'full' = logged in. 'password' = password checked, a second step (2FA, later) still missing.
    .addColumn('auth_level', 'text', col => col.notNull().check(sql`auth_level in ('password', 'full')`))
    // 1 = "Zapamiętaj mnie": the cookie survives closing the browser.
    .addColumn('persistent', 'integer', col => col.notNull().check(sql`persistent in (0, 1)`))
    .addColumn('created_utc', 'text', col => col.notNull())
    .addColumn('expires_utc', 'text', col => col.notNull())
    .execute();
  await db.schema.createIndex('sessions_user_id').on('sessions').column('user_id').execute();

  await db.schema
    .createTable('user_tokens')
    // SHA-256 of the token sent in the link; the token itself is never stored.
    .addColumn('token_hash', 'text', col => col.primaryKey())
    .addColumn('user_id', 'text', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('purpose', 'text', col => col.notNull().check(sql`purpose in ('confirm-email', 'change-email', 'reset-password')`))
    // For 'change-email': the address being confirmed.
    .addColumn('new_email', 'text')
    .addColumn('expires_utc', 'text', col => col.notNull())
    .execute();
  await db.schema.createIndex('user_tokens_user_id').on('user_tokens').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_tokens').execute();
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('users').execute();
}
