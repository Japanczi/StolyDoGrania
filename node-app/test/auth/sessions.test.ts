import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sha256 } from '../../src/auth/random.ts';
import { createSession, deleteUserSessions, loadSession, sessionLifetimeMs } from '../../src/auth/sessions.ts';
import { addUser, createTestDb } from '../helpers.ts';

describe('sessions', () => {
  test('a session loads its user; only the hash of the id is stored', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1', { role: 'admin' });

    const { id } = await createSession(db, user.id, { persistent: false, authLevel: 'full' });
    const loaded = await loadSession(db, id);
    assert.equal(loaded?.user.id, user.id);
    assert.equal(loaded?.user.role, 'admin');

    const rows = await db.selectFrom('sessions').select('id_hash').execute();
    assert.deepEqual(rows, [{ id_hash: sha256(id) }]);
    assert.equal(await loadSession(db, sha256(id)), null, 'the stored hash itself is not a valid cookie');
  });

  test('an expired session is refused and deleted', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const start = new Date('2026-11-01T00:00:00Z');
    const { id } = await createSession(db, user.id, { persistent: true, authLevel: 'full' }, start);

    assert.equal(await loadSession(db, id, new Date(start.getTime() + sessionLifetimeMs + 1)), null);
    assert.equal((await db.selectFrom('sessions').selectAll().execute()).length, 0);
  });

  test('using a session in its second half pushes the expiry back', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const start = new Date('2026-11-01T00:00:00Z');
    const { id } = await createSession(db, user.id, { persistent: true, authLevel: 'full' }, start);

    const early = await loadSession(db, id, new Date(start.getTime() + 1000));
    assert.equal(early?.renewedExpires, null);
    const lateNow = new Date(start.getTime() + sessionLifetimeMs * 0.75);
    const late = await loadSession(db, id, lateNow);
    assert.equal(late?.renewedExpires?.getTime(), lateNow.getTime() + sessionLifetimeMs);
  });

  test("a 'password' session (second step pending, for 2FA later) is not logged in", async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const { id } = await createSession(db, user.id, { persistent: false, authLevel: 'password' });
    assert.equal(await loadSession(db, id), null);
  });

  test('deleteUserSessions can keep the current session', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const a = await createSession(db, user.id, { persistent: false, authLevel: 'full' });
    const b = await createSession(db, user.id, { persistent: false, authLevel: 'full' });

    await deleteUserSessions(db, user.id, sha256(a.id));
    assert.notEqual(await loadSession(db, a.id), null);
    assert.equal(await loadSession(db, b.id), null);
  });

  test('a role change applies to an existing session at once', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const { id } = await createSession(db, user.id, { persistent: false, authLevel: 'full' });
    await db.updateTable('users').set({ role: 'admin' }).where('id', '=', user.id).execute();
    assert.equal((await loadSession(db, id))?.user.role, 'admin');
  });

  test('deleting the user ends their sessions', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const { id } = await createSession(db, user.id, { persistent: false, authLevel: 'full' });
    await db.deleteFrom('users').where('id', '=', user.id).execute();
    assert.equal(await loadSession(db, id), null);
  });
});
