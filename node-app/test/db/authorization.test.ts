// Port of Planszowkarz.Tests/AuthorizationTests.cs. The slot-removal rule runs as a real DELETE against an
// in-memory SQLite database, proving it is enforced on the server (in the query), not only in the UI.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Db } from '../../src/db/database.ts';
import { freeSlot, insertTable } from '../../src/db/queries/board.ts';
import { insertHandAddedGame } from '../../src/db/queries/games.ts';
import { tryAddPlayer, tryCreate, tryTakeSlot } from '../../src/domain/play-table.ts';
import { canManage } from '../../src/domain/roles.ts';
import { addUser, createTestDb } from '../helpers.ts';

describe('role rules', () => {
  const cases = [['owner', true, false], ['owner', false, false], ['admin', true, true], ['admin', false, false], ['user', false, true]] as const;
  for (const [target, actorIsOwner, expected] of cases) {
    test(`canManage(${target}, actorIsOwner=${actorIsOwner}) = ${expected}`, () => {
      assert.equal(canManage(target, actorIsOwner), expected);
    });
  }
});

/** A table owned by "owner" (slot 1), with "ala" in slot 2 and a guest without an account in slot 3. */
async function setUp(): Promise<{ db: Db; tableId: number }> {
  const db = await createTestDb();
  const owner = await addUser(db, 'Owner', 'haslo1');
  const ala = await addUser(db, 'Ala', 'haslo1');
  await addUser(db, 'Someone', 'haslo1');
  const gameId = await insertHandAddedGame(db, { name: 'Catan', kind: 'small', maxPlayers: 4, cover: null });
  const created = tryCreate({ gameId, gameTitle: 'Catan', kind: 'small', maxPlayers: 4, takenSlots: 0, startHour: null, ownerUserId: owner.id, ownerName: 'Owner' });
  assert.ok(created.ok);
  assert.ok(tryTakeSlot(created.table, 2, 'Ala', ala.id).ok);
  assert.ok(tryAddPlayer(created.table, 3, 'Gość', null).ok);
  const tableId = await insertTable(db, created.table, { text: 'Catan', userId: owner.id });
  return { db, tableId };
}

async function idOf(db: Db, userName: string): Promise<string> {
  return (await db.selectFrom('users').select('id').where('user_name', '=', userName).executeTakeFirstOrThrow()).id;
}

async function removableSlots(db: Db, tableId: number, userId: string, isAdmin: boolean): Promise<number[]> {
  // Tries to free every seat; whatever got deleted was allowed. Each try runs in a rolled-back copy of the state.
  const allowed: number[] = [];
  for (const slot of [1, 2, 3]) {
    await db.transaction().execute(async trx => {
      if (await freeSlot(trx, tableId, slot, { userId, name: 'x', isAdmin })) {
        allowed.push(slot);
      }
      throw new Rollback();
    }).catch(err => { if (!(err instanceof Rollback)) throw err; });
  }
  return allowed;
}

class Rollback extends Error {}

describe('slot removal (removableBy, in the DELETE query)', () => {
  test('a player can free only their own seat', async t => {
    const { db, tableId } = await setUp();
    t.after(() => db.destroy());
    assert.deepEqual(await removableSlots(db, tableId, await idOf(db, 'Ala'), false), [2]);
  });

  test("the table's owner can free any seat at their table", async t => {
    const { db, tableId } = await setUp();
    t.after(() => db.destroy());
    assert.deepEqual(await removableSlots(db, tableId, await idOf(db, 'Owner'), false), [1, 2, 3]);
  });

  test('a stranger cannot free anything', async t => {
    const { db, tableId } = await setUp();
    t.after(() => db.destroy());
    assert.deepEqual(await removableSlots(db, tableId, await idOf(db, 'Someone'), false), []);
  });

  test('an admin can free any seat', async t => {
    const { db, tableId } = await setUp();
    t.after(() => db.destroy());
    assert.deepEqual(await removableSlots(db, tableId, await idOf(db, 'Someone'), true), [1, 2, 3]);
  });
});

describe('deleted accounts (decided 2026-11-10: seats and tables stay)', () => {
  test("a deleted user's seat keeps the name and their table loses its owner", async t => {
    const { db, tableId } = await setUp();
    t.after(() => db.destroy());
    await db.deleteFrom('users').where('user_name', 'in', ['Owner', 'Ala']).execute();
    const table = await db.selectFrom('play_tables').select('owner_user_id').where('id', '=', tableId).executeTakeFirstOrThrow();
    assert.equal(table.owner_user_id, null);
    const seats = await db.selectFrom('table_slots').select(['slot_number', 'participant_name', 'user_id']).orderBy('slot_number').execute();
    assert.deepEqual(seats, [
      { slot_number: 1, participant_name: 'Owner', user_id: null },
      { slot_number: 2, participant_name: 'Ala', user_id: null },
      { slot_number: 3, participant_name: 'Gość', user_id: null },
    ]);
  });
});
