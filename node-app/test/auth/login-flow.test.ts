import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkLogin, lockoutMs, maxFailedAttempts } from '../../src/auth/login-flow.ts';
import { findUserById } from '../../src/db/queries/users.ts';
import { addUser, createTestDb } from '../helpers.ts';

describe('checkLogin', () => {
  test('accepts the e-mail or the user name, case-insensitively', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    await addUser(db, 'Jan Nowak', 'haslo1', { email: 'jan@example.com' });

    for (const login of ['Jan Nowak', 'jan nowak', ' JAN@example.com ', 'jan@EXAMPLE.com']) {
      assert.equal((await checkLogin(db, login, 'haslo1')).kind, 'success', login);
    }
  });

  test('wrong password and unknown login both give "invalid"', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    await addUser(db, 'Jan Nowak', 'haslo1');

    assert.equal((await checkLogin(db, 'Jan Nowak', 'zle')).kind, 'invalid');
    assert.equal((await checkLogin(db, 'Nikt', 'haslo1')).kind, 'invalid');
  });

  test(`${maxFailedAttempts} wrong passwords lock the account; even the right password fails until it expires`, async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    const now = new Date('2026-11-10T12:00:00Z');

    for (let i = 1; i < maxFailedAttempts; i++) {
      assert.equal((await checkLogin(db, 'Jan Nowak', 'zle', now)).kind, 'invalid', `attempt ${i}`);
    }
    assert.equal((await checkLogin(db, 'Jan Nowak', 'zle', now)).kind, 'locked-out');
    assert.equal((await checkLogin(db, 'Jan Nowak', 'haslo1', now)).kind, 'locked-out');

    const later = new Date(now.getTime() + lockoutMs + 1);
    assert.equal((await checkLogin(db, 'Jan Nowak', 'haslo1', later)).kind, 'success');
    const row = await findUserById(db, user.id);
    assert.equal(row?.access_failed_count, 0);
    assert.equal(row?.lockout_end_utc, null);
  });

  test('a success resets the failure counter', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'haslo1');
    await checkLogin(db, 'Jan Nowak', 'zle');
    await checkLogin(db, 'Jan Nowak', 'haslo1');
    assert.equal((await findUserById(db, user.id))?.access_failed_count, 0);
  });

  test('an unconfirmed e-mail is reported only after the right password', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    await addUser(db, 'Jan Nowak', 'haslo1', { confirmed: false });
    assert.equal((await checkLogin(db, 'Jan Nowak', 'zle')).kind, 'invalid');
    assert.equal((await checkLogin(db, 'Jan Nowak', 'haslo1')).kind, 'email-not-confirmed');
  });

  test('an old ASP.NET Identity hash logs in and is replaced with scrypt', async t => {
    const db = await createTestDb();
    t.after(() => db.destroy());
    const user = await addUser(db, 'Jan Nowak', 'tymczasowe');
    // The real .NET hash of "gracz" (see password-hash.test.ts).
    await db.updateTable('users')
      .set({ password_hash: 'AQAAAAIAAYagAAAAEK5FkIRxq/2VBn//ycMkwExrRyuu131MiiuLbx/FXdqfDYjVRNXy1f2iCTMGPsrrwQ==' })
      .where('id', '=', user.id).execute();

    assert.equal((await checkLogin(db, 'Jan Nowak', 'gracz')).kind, 'success');
    const hash = (await findUserById(db, user.id))?.password_hash ?? '';
    assert.match(hash, /^scrypt\$/);
    assert.equal((await checkLogin(db, 'Jan Nowak', 'gracz')).kind, 'success', 'the new hash works');
  });
});
