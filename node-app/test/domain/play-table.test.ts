// Port of Planszowkarz.Tests/PlayTableTests.cs: pure domain rules, no database, no UI.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  freeSlots, isFull, isSlotTaken, join, leave, maxTakenSlots, ownerSlot, tryAddPlayer, tryAssignOwner, tryChangeGame,
  tryCreate, trySetTakenSlots, tryTakeSlot, type PlayTable,
} from '../../src/domain/play-table.ts';

function createTable(maxPlayers = 4, takenSlots = 0, ownerId = 'owner'): PlayTable {
  const result = tryCreate({
    gameId: 1, gameTitle: 'Catan', kind: 'small', maxPlayers, takenSlots, startHour: null, ownerUserId: ownerId, ownerName: 'Owner',
  });
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.table;
}

describe('PlayTable', () => {
  test('tryCreate seats the owner in the first slot', () => {
    const table = createTable();
    assert.equal(table.ownerUserId, 'owner');
    assert.deepEqual(table.participants, [{ slotNumber: ownerSlot, participantName: 'Owner', userId: 'owner' }]);
  });

  for (const [maxPlayers, takenSlots, why] of [[0, 0, 'no seats at all'], [4, 4, 'no room for the owner'], [4, -1, 'negative']] as const) {
    test(`tryCreate rejects invalid seat counts (${why})`, () => {
      const result = tryCreate({
        gameId: 1, gameTitle: 'Catan', kind: 'small', maxPlayers, takenSlots, startHour: null, ownerUserId: 'owner', ownerName: 'Owner',
      });
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.length > 0);
    });
  }

  test('marks fill the highest-numbered seats and never the owner seat', () => {
    const table = createTable(4, 2);
    assert.equal(isSlotTaken(table, 4), true);
    assert.equal(isSlotTaken(table, 3), true);
    assert.equal(isSlotTaken(table, 2), false);
    assert.equal(isSlotTaken(table, ownerSlot), false);
    assert.equal(freeSlots(table), 1); // 4 seats - 2 marked - owner
  });

  test('marks skip seated players', () => {
    const table = createTable(4);
    assert.ok(tryTakeSlot(table, 4, 'Ala', 'ala').ok);
    assert.ok(trySetTakenSlots(table, 1).ok);
    assert.equal(isSlotTaken(table, 4), false); // Ala sits there
    assert.equal(isSlotTaken(table, 3), true);
  });

  test('trySetTakenSlots rejects more than the markable seats', () => {
    const table = createTable(4);
    assert.equal(maxTakenSlots(table), 3);
    const result = trySetTakenSlots(table, 4);
    assert.deepEqual(result, { ok: false, error: 'Liczba zajętych miejsc musi mieścić się w zakresie 0–3.' });
    assert.equal(table.takenSlots, 0);
  });

  test('tryTakeSlot allows one seat per user', () => {
    const table = createTable();
    assert.ok(tryTakeSlot(table, 2, 'Ala', 'ala').ok);
    assert.deepEqual(tryTakeSlot(table, 3, 'Ala', 'ala'), { ok: false, error: 'Masz już miejsce przy tym stole.' });
  });

  test('tryTakeSlot rejects occupied, marked and out-of-range seats', () => {
    const table = createTable(4, 1);
    assert.ok(tryTakeSlot(table, 2, 'Ala', 'ala').ok);
    assert.equal(tryTakeSlot(table, 2, 'Ola', 'ola').ok, false); // occupied
    assert.equal(tryTakeSlot(table, 4, 'Ola', 'ola').ok, false); // marked as taken
    assert.equal(tryTakeSlot(table, 5, 'Ola', 'ola').ok, false); // out of range
  });

  test('the owner may only take the first seat', () => {
    const table = createTable();
    leave(table, ownerSlot);
    assert.deepEqual(tryTakeSlot(table, 2, 'Owner', 'owner'), { ok: false, error: 'Jako właściciel stołu możesz zająć tylko pierwsze miejsce.' });
  });

  test('taking the vacant owner seat hands the table over', () => {
    const table = createTable();
    assert.equal(leave(table, ownerSlot), true);
    assert.ok(tryTakeSlot(table, ownerSlot, 'Ala', 'ala').ok);
    assert.equal(table.ownerUserId, 'ala');
  });

  test('a table without an owner stays without one when its first seat is taken', () => {
    const table = createTable();
    table.ownerUserId = null; // e.g. the owner's account was deleted
    leave(table, ownerSlot);
    assert.ok(tryTakeSlot(table, ownerSlot, 'Ala', 'ala').ok);
    assert.equal(table.ownerUserId, null);
  });

  test('tryAddPlayer on a marked seat lowers the counter', () => {
    const table = createTable(4, 2);
    assert.ok(tryAddPlayer(table, 4, 'Gość', null).ok);
    assert.equal(table.takenSlots, 1);
    assert.equal(isSlotTaken(table, 3), true);
  });

  test('tryAddPlayer cannot use the owner seat', () => {
    const table = createTable();
    leave(table, ownerSlot);
    assert.equal(tryAddPlayer(table, ownerSlot, 'Gość', null).ok, false);
  });

  test('tryAddPlayer refuses a registered user who already sits there, and empty names', () => {
    const table = createTable();
    assert.ok(tryTakeSlot(table, 2, 'Ala', 'ala').ok);
    assert.deepEqual(tryAddPlayer(table, 3, 'Ala', 'ala'), { ok: false, error: 'Ten gracz ma już miejsce przy tym stole.' });
    assert.deepEqual(tryAddPlayer(table, 3, '   ', null), { ok: false, error: 'Nazwa gracza musi mieć od 1 do 100 znaków.' });
  });

  test('tryAssignOwner moves the new owner to the first seat', () => {
    const table = createTable();
    assert.ok(tryTakeSlot(table, 3, 'Ala', 'ala').ok);
    assert.ok(tryAssignOwner(table, 'ala', 'Ala').ok);
    assert.equal(table.ownerUserId, 'ala');
    assert.deepEqual(table.participants, [{ slotNumber: ownerSlot, participantName: 'Ala', userId: 'ala' }]);
  });

  test('tryChangeGame clears the players but keeps the owner', () => {
    const table = createTable(4, 1);
    tryTakeSlot(table, 2, 'Ala', 'ala');
    assert.ok(tryChangeGame(table, 2, '  Azul ', 6).ok);
    assert.equal(table.gameTitle, 'Azul');
    assert.equal(table.gameId, 2);
    assert.equal(table.maxPlayers, 6);
    assert.equal(table.takenSlots, 0);
    assert.deepEqual(table.participants.map(p => p.userId), ['owner']);
  });

  test('join uses the first free unmarked seat and returns null when full', () => {
    const table = createTable(3, 1);
    assert.equal(join(table, 'Gość'), 2);
    assert.equal(join(table, 'Drugi gość'), null); // seat 3 is marked as taken
    assert.equal(isFull(table), true);
  });
});
