// The one-time .NET → Node database conversion, against a small fake app.db with the EF/Identity table layout
// (columns as in the real database: see Migrations/ApplicationDbContextModelSnapshot.cs).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import SqliteDatabase from 'better-sqlite3';
import { convertDotnetDb, hourOf, toIso } from '../../scripts/import-dotnet-db.ts';
import { checkLogin } from '../../src/auth/login-flow.ts';
import { createTestDb } from '../helpers.ts';

// Real .NET hash of the public dev password "gracz" (see test/auth/password-hash.test.ts).
const dotnetHash = 'AQAAAAIAAYagAAAAEK5FkIRxq/2VBn//ycMkwExrRyuu131MiiuLbx/FXdqfDYjVRNXy1f2iCTMGPsrrwQ==';

function fakeDotnetDb(): SqliteDatabase.Database {
  const db = new SqliteDatabase(':memory:');
  db.exec(`
    create table AspNetUsers (Id text, UserName text, NormalizedUserName text, Email text, NormalizedEmail text, EmailConfirmed integer,
      PasswordHash text, SecurityStamp text, ConcurrencyStamp text, PhoneNumber text, PhoneNumberConfirmed integer, TwoFactorEnabled integer,
      LockoutEnd text, LockoutEnabled integer, AccessFailedCount integer);
    create table AspNetRoles (Id text, Name text, NormalizedName text, ConcurrencyStamp text);
    create table AspNetUserRoles (UserId text, RoleId text);
    create table Games (Id integer, Name text, Kind text, Difficulty text, MaxPlayers integer, BggUrl text, Cover blob,
      CoverContentType text, BggId integer, YearPublished integer, IsFromSheet integer);
    create table GameAlternateNames (GameId integer, Name text);
    create table PlayTables (Id integer, GameId integer, Start text, MaxPlayers integer, TakenSlots integer, OwnerUserId text, Kind text,
      GameTitle text, ImportKey text, ImportOrder integer);
    create table TableSlots (PlayTableId integer, SlotNumber integer, ParticipantName text, UserId text, IsImported integer);
    create table TablePhrases (Id integer, Phrase text, GameId integer, UserId text, CreatedUtc text);
    create table UserActionLogs (Id integer, CreatedUtc text, Action text, ActorUserId text, ActorName text, TargetUserId text,
      TargetName text, PlayTableId integer, Details text);
    create table BoardSettings (Id integer, AutoResetEnabled integer, AutoResetCheckedUtc text);

    insert into AspNetRoles values ('r1', 'Owner', 'OWNER', null), ('r2', 'Admin', 'ADMIN', null), ('r3', 'User', 'USER', null);
    insert into AspNetUsers values
      ('u-owner', 'szef@example.com', 'SZEF@EXAMPLE.COM', 'szef@example.com', 'SZEF@EXAMPLE.COM', 1, '${dotnetHash}', 's', 'c', null, 0, 1, null, 1, 0),
      ('u-jan', 'Jan Nowak', 'JAN NOWAK', 'jan@example.com', 'JAN@EXAMPLE.COM', 1, '${dotnetHash}', 's', 'c', '+48 600', 0, 0, '2026-11-10 12:00:00+00:00', 1, 2);
    insert into AspNetUserRoles values ('u-owner', 'r1'), ('u-owner', 'r2'), ('u-jan', 'r3');
    insert into Games values (7, 'Azul', 'Big', '1.7637', 4, 'https://boardgamegeek.com/boardgame/230802', x'89504e47', 'image/png', 230802, 2017, 0),
      (8, 'Stara gra', 'Small', '0.0', 5, 'https://boardgamegeek.com/', x'3c737667', 'image/svg+xml', null, null, 0);
    insert into GameAlternateNames values (7, 'Azul: Kafelki');
    insert into PlayTables values (40, 7, '2026-11-08 18:30:00', 4, 1, 'u-jan', 'Other', 'Azul!', null, null),
      (41, 8, '0001-01-01 00:00:00', 5, 0, 'u-deleted', 'Small', null, 'stara gra#1', 3);
    insert into TableSlots values (40, 1, 'Jan Nowak', 'u-jan', 0), (40, 2, 'Gość', null, 0), (41, 2, 'Ktoś', 'u-deleted', 1);
    insert into TablePhrases values (3, 'Azul!', 7, 'u-jan', '2026-11-08 12:22:05.1583368');
    insert into UserActionLogs values (9, '2026-11-08 18:00:00.123', 'JoinedTable', 'u-jan', 'Jan Nowak', null, null, 40, 'Azul! – miejsce 1');
    insert into BoardSettings values (1, 1, '2026-11-03 10:00:00');
  `);
  return db;
}

describe('convertDotnetDb', () => {
  test('copies everything, keeping ids; adjusts what the new schema stores differently', async t => {
    const source = fakeDotnetDb();
    const target = await createTestDb();
    t.after(async () => { source.close(); await target.destroy(); });

    const report = await convertDotnetDb(source, target, new Date('2026-12-01T00:00:00Z'));
    assert.deepEqual(report.counts, { users: 2, games: 2, alternateNames: 1, tables: 2, seats: 3, phrases: 1, logEntries: 1 });
    assert.deepEqual(report.twoFactorUsers, ['szef@example.com']);
    assert.equal(report.warnings.length, 3, report.warnings.join('\n'));

    const users = await target.selectFrom('users').select(['id', 'role', 'phone_number', 'lockout_end_utc', 'access_failed_count']).orderBy('id').execute();
    assert.deepEqual(users, [
      { id: 'u-jan', role: 'user', phone_number: '+48 600', lockout_end_utc: '2026-11-10T12:00:00.000Z', access_failed_count: 2 },
      { id: 'u-owner', role: 'owner', phone_number: null, lockout_end_utc: null, access_failed_count: 0 },
    ]);

    const games = await target.selectFrom('games').select(['id', 'kind', 'weight', 'cover_type']).orderBy('id').execute();
    assert.deepEqual(games, [
      { id: 7, kind: 'big', weight: '1.7637', cover_type: 'image/png' },
      { id: 8, kind: 'small', weight: '0', cover_type: null },
    ]);

    const tables = await target.selectFrom('play_tables').select(['id', 'start_hour', 'kind', 'owner_user_id', 'import_key', 'import_order']).orderBy('id').execute();
    assert.deepEqual(tables, [
      { id: 40, start_hour: '18:30', kind: 'other', owner_user_id: 'u-jan', import_key: null, import_order: null },
      { id: 41, start_hour: null, kind: 'small', owner_user_id: null, import_key: 'stara gra#1', import_order: 3 },
    ]);
    const seats = await target.selectFrom('table_slots').select(['play_table_id', 'slot_number', 'user_id', 'is_imported']).orderBy('play_table_id').orderBy('slot_number').execute();
    assert.deepEqual(seats, [
      { play_table_id: 40, slot_number: 1, user_id: 'u-jan', is_imported: 0 },
      { play_table_id: 40, slot_number: 2, user_id: null, is_imported: 0 },
      { play_table_id: 41, slot_number: 2, user_id: null, is_imported: 1 },
    ]);

    const phrase = await target.selectFrom('table_phrases').selectAll().executeTakeFirstOrThrow();
    assert.equal(phrase.created_utc, '2026-11-08T12:22:05.158Z');
    const settings = await target.selectFrom('board_settings').selectAll().executeTakeFirstOrThrow();
    assert.deepEqual(settings, { id: 1, auto_reset_enabled: 1, auto_reset_checked_utc: '2026-11-03T10:00:00.000Z' });
  });

  test('migrated users log in with their old .NET password (by user name or e-mail)', async t => {
    const source = fakeDotnetDb();
    const target = await createTestDb();
    t.after(async () => { source.close(); await target.destroy(); });
    await convertDotnetDb(source, target);
    assert.equal((await checkLogin(target, 'jan@example.com', 'gracz')).kind, 'success');
    assert.equal((await checkLogin(target, 'szef@example.com', 'gracz')).kind, 'success');
  });

  test('a failure leaves the target empty (one transaction)', async t => {
    const source = fakeDotnetDb();
    source.exec(`insert into TablePhrases values (4, 'x', null, null, 'not a date')`);
    const target = await createTestDb();
    t.after(async () => { source.close(); await target.destroy(); });
    await assert.rejects(convertDotnetDb(source, target), /Unreadable date/);
    assert.equal((await target.selectFrom('users').select('id').execute()).length, 0);
  });
});

describe('date helpers', () => {
  test('hourOf', () => {
    assert.equal(hourOf('2026-11-08 18:30:00'), '18:30');
    assert.equal(hourOf('0001-01-01 00:00:00'), null);
  });
  test('toIso', () => {
    assert.equal(toIso('2026-11-08 12:22:05.1583368'), '2026-11-08T12:22:05.158Z');
    assert.equal(toIso('2026-11-10 13:00:00+01:00'), '2026-11-10T12:00:00.000Z');
  });
});
