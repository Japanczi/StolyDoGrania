import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getAutoReset, saveAutoReset } from '../../src/db/queries/board-settings.ts';
import { insertTable } from '../../src/db/queries/board.ts';
import { insertHandAddedGame } from '../../src/db/queries/games.ts';
import { isAutoResetDue, lastMondayMidnight, setAutoReset } from '../../src/domain/board-settings.ts';
import { tryCreate } from '../../src/domain/play-table.ts';
import { resetIfDue } from '../../src/jobs/weekly-reset.ts';
import { createLiveHub } from '../../src/live/hub.ts';
import { addUser, createTestDb } from '../helpers.ts';

describe('lastMondayMidnight (Europe/Warsaw)', () => {
  test('a Wednesday in winter (UTC+1): Monday 00:00 Warsaw = Sunday 23:00 UTC', () => {
    assert.equal(lastMondayMidnight(new Date('2026-11-11T12:00:00Z')).toISOString(), '2026-11-08T23:00:00.000Z');
  });

  test('a day in summer (UTC+2): Monday 00:00 Warsaw = Sunday 22:00 UTC', () => {
    assert.equal(lastMondayMidnight(new Date('2026-07-15T12:00:00Z')).toISOString(), '2026-07-12T22:00:00.000Z');
  });

  test('Sunday 23:30 UTC is already Monday in Warsaw', () => {
    assert.equal(lastMondayMidnight(new Date('2026-11-08T23:30:00Z')).toISOString(), '2026-11-08T23:00:00.000Z');
  });

  test('the week the clocks change (Sunday 2026-03-29) still finds Monday 00:00', () => {
    assert.equal(lastMondayMidnight(new Date('2026-03-31T10:00:00Z')).toISOString(), '2026-03-29T22:00:00.000Z');
  });
});

describe('auto reset rule (BoardSettings.cs)', () => {
  const monday = new Date('2026-11-08T23:00:00Z');

  test('turning it on midweek waits for the next Monday', () => {
    const on = setAutoReset({ enabled: false, checkedUtc: null }, true, new Date('2026-11-11T10:00:00Z'));
    assert.equal(isAutoResetDue(on, new Date('2026-11-13T10:00:00Z')), false);
    assert.equal(isAutoResetDue(on, new Date('2026-11-15T23:00:01Z')), true, 'after the next Monday 00:00');
  });

  test('a missed Monday is caught up once; off means never', () => {
    const settings = { enabled: true, checkedUtc: new Date(monday.getTime() - 14 * 86_400_000) };
    assert.equal(isAutoResetDue(settings, new Date('2026-11-10T08:00:00Z')), true);
    assert.equal(isAutoResetDue({ ...settings, checkedUtc: new Date('2026-11-10T08:00:00Z') }, new Date('2026-11-10T09:00:00Z')), false);
    assert.equal(isAutoResetDue({ ...settings, enabled: false }, new Date('2026-11-10T08:00:00Z')), false);
  });

  test('switching off and on again records a new start', () => {
    const on = { enabled: true, checkedUtc: new Date('2026-01-01T00:00:00Z') };
    assert.deepEqual(setAutoReset(on, true, new Date()), on, 'already on: unchanged');
    assert.equal(setAutoReset(on, false, new Date()).enabled, false);
  });
});

describe('resetIfDue (the job)', () => {
  test('clears every table when due, records it, tells open pages – and keeps the games', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const hub = createLiveHub();
    const owner = await addUser(db, 'Owner', 'haslo1');
    const gameId = await insertHandAddedGame(db, { name: 'Gra', kind: 'small', maxPlayers: 4, cover: null });
    const created = tryCreate({ gameId, gameTitle: 'Gra', kind: 'small', maxPlayers: 4, takenSlots: 0, startHour: null, ownerUserId: owner.id, ownerName: 'Owner' });
    assert.ok(created.ok);
    await insertTable(db, created.table, { text: 'Gra', userId: owner.id });

    await saveAutoReset(db, { enabled: true, checkedUtc: new Date('2026-11-04T10:00:00Z') });
    const now = new Date('2026-11-10T08:00:00Z');
    assert.equal(await resetIfDue({ db, hub, now: () => now }), 1);
    assert.equal((await db.selectFrom('play_tables').select('id').execute()).length, 0);
    assert.equal((await db.selectFrom('games').select('id').execute()).length, 1);
    assert.equal((await getAutoReset(db)).checkedUtc?.toISOString(), now.toISOString());
    assert.equal(hub.version, 1);

    assert.equal(await resetIfDue({ db, hub, now: () => new Date('2026-11-10T08:01:00Z') }), null, 'not twice');
    assert.equal(hub.version, 1);
  });
});
