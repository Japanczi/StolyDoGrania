// Admin features through HTTP: the users page (Owner rules), normal user mode, and the board's toolbox.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { findUserByUserName } from '../../src/db/queries/users.ts';
import { addUser, createTestApp, TestBrowser } from '../helpers.ts';

async function setUp(feedbackDir?: string) {
  const s = await createTestApp(feedbackDir ? { feedbackDir } : {});
  const owner = await addUser(s.db, 'Szef', 'haslo1', { role: 'owner' });
  const admin = await addUser(s.db, 'Adam', 'haslo1', { role: 'admin' });
  const admin2 = await addUser(s.db, 'Beata', 'haslo1', { role: 'admin' });
  const user = await addUser(s.db, 'Gracz', 'haslo1');
  const as = async (name: string) => {
    const b = new TestBrowser(s.app);
    await b.login(name, 'haslo1');
    return b;
  };
  return { ...s, owner, admin, admin2, user, as };
}

const roleOf = async (s: Awaited<ReturnType<typeof setUp>>, name: string) => (await findUserByUserName(s.db, name))?.role;

describe('admin users page', () => {
  test('only admins get in', async t => {
    const s = await setUp();
    t.after(s.close);
    assert.equal((await new TestBrowser(s.app).get('/admin/users')).headers.location, '/Account/Login?ReturnUrl=%2Fadmin%2Fusers');
    assert.equal((await (await s.as('Gracz')).get('/admin/users')).headers.location, '/Account/AccessDenied');
    const page = (await (await s.as('Adam')).get('/admin/users')).body;
    assert.match(page, /Zarządzanie użytkownikami/);
    assert.match(page, /title="Główny administrator">Owner</);
  });

  test('an admin may promote users and delete regular users, but not touch other admins or the Owner', async t => {
    const s = await setUp();
    t.after(s.close);
    const adam = await s.as('Adam');

    await adam.post(`/admin/users/${s.user.id}/role`, { Role: 'admin' });
    assert.equal(await roleOf(s, 'Gracz'), 'admin');

    await adam.post(`/admin/users/${s.admin2.id}/role`, { Role: 'user' });
    assert.equal(await roleOf(s, 'Beata'), 'admin', 'only the Owner demotes admins');
    assert.match((await adam.get('/admin/users')).body, /Tylko główny administrator \(Owner\) może odebrać rolę/);

    await adam.post(`/admin/users/${s.owner.id}/role`, { Role: 'user' });
    assert.equal(await roleOf(s, 'Szef'), 'owner');
    await adam.post(`/admin/users/${s.owner.id}/delete`, {});
    assert.ok(await findUserByUserName(s.db, 'Szef'), 'nobody deletes the Owner');
    await adam.post(`/admin/users/${s.admin2.id}/delete`, {});
    assert.ok(await findUserByUserName(s.db, 'Beata'));
    await adam.post(`/admin/users/${s.admin.id}/delete`, {});
    assert.ok(await findUserByUserName(s.db, 'Adam'), 'not yourself either');
  });

  test('the Owner may demote and delete admins; both are logged', async t => {
    const s = await setUp();
    t.after(s.close);
    const szef = await s.as('Szef');
    await szef.post(`/admin/users/${s.admin2.id}/role`, { Role: 'user' });
    assert.equal(await roleOf(s, 'Beata'), 'user');
    await szef.post(`/admin/users/${s.admin.id}/delete`, {});
    assert.equal(await findUserByUserName(s.db, 'Adam'), undefined);
    const log = await s.db.selectFrom('user_action_logs').select(['action', 'actor_name', 'target_name', 'details']).orderBy('id').execute();
    assert.deepEqual(log, [
      { action: 'RoleChanged', actor_name: 'Szef', target_name: 'Beata', details: 'Admin → User' },
      { action: 'UserRemoved', actor_name: 'Szef', target_name: 'Adam', details: 'Rola: Admin' },
    ]);
  });

  test('a role can only be set to Admin or User; the add form validates like registration', async t => {
    const s = await setUp();
    t.after(s.close);
    const adam = await s.as('Adam');
    await adam.post(`/admin/users/${s.user.id}/role`, { Role: 'owner' });
    assert.equal(await roleOf(s, 'Gracz'), 'user');

    const bad = await adam.post('/admin/users/add', { UserName: 'x', Email: 'a@b', Password: '1', Role: 'user' });
    assert.match(bad.body, /Nazwa użytkownika: 3–20 znaków/);
    const ok = await adam.post('/admin/users/add', { UserName: 'Nowy', Email: 'nowy@example.com', Password: 'haslo12', Role: 'admin' });
    assert.equal(ok.statusCode, 303);
    assert.equal(await roleOf(s, 'Nowy'), 'admin');
    assert.equal((await findUserByUserName(s.db, 'Nowy'))?.email_confirmed, 1);
  });

  test('a promotion applies to the user’s next request (no new login needed)', async t => {
    const s = await setUp();
    t.after(s.close);
    const gracz = await s.as('Gracz');
    assert.doesNotMatch((await gracz.get('/')).body, /Użytkownicy/);
    await (await s.as('Adam')).post(`/admin/users/${s.user.id}/role`, { Role: 'admin' });
    assert.match((await gracz.get('/')).body, /href="\/admin\/users"/);
  });
});

describe('normal user mode', () => {
  test('an admin in the mode is treated as a regular user everywhere, and can switch back', async t => {
    const s = await setUp();
    t.after(s.close);
    const adam = await s.as('Adam');
    assert.match((await adam.get('/')).body, /id="admin-dock"/);

    assert.deepEqual((await adam.postJson('/api/admin/normal-user-mode', { active: true })).json(), { ok: true });
    const board = (await adam.get('/')).body;
    assert.doesNotMatch(board, /id="admin-dock"/);
    assert.doesNotMatch(board, /href="\/admin\/users"/);
    assert.match(board, /id="normal-user-mode" type="checkbox" class="form-check-input" checked/, 'the switch stays to get back');
    assert.equal((await adam.get('/admin/users')).headers.location, '/Account/AccessDenied');
    assert.equal((await adam.postJson('/api/admin/clear-tables')).json().ok, false);

    await adam.postJson('/api/admin/normal-user-mode', { active: false });
    assert.match((await adam.get('/')).body, /id="admin-dock"/);
  });

  test('a regular user cannot switch it on to gain anything', async t => {
    const s = await setUp();
    t.after(s.close);
    const gracz = await s.as('Gracz');
    assert.equal((await gracz.postJson('/api/admin/normal-user-mode', { active: true })).json().ok, false);
    assert.doesNotMatch((await gracz.get('/')).body, /normal-user-mode/);
  });
});

describe('admin toolbox', () => {
  test('clear tables, the Auto switch and disk usage are admin-only', async t => {
    const s = await setUp();
    t.after(s.close);
    const gracz = await s.as('Gracz');
    assert.equal((await gracz.postJson('/api/admin/clear-tables')).json().error, 'Tylko administrator może wyczyścić listę stołów.');
    assert.equal((await gracz.postJson('/api/admin/auto-reset', { enabled: true })).json().ok, false);
    assert.equal((await gracz.get('/api/admin/disk-usage')).statusCode, 403);

    const adam = await s.as('Adam');
    assert.deepEqual((await adam.postJson('/api/admin/clear-tables')).json(), { ok: true, message: 'Usunięto wszystkie stoły (0).' });
    assert.equal((await adam.postJson('/api/admin/auto-reset', { enabled: true })).json().ok, true);
    assert.equal((await adam.get('/api/admin/toolbox')).json().autoReset, true);
    const disk = (await adam.get('/api/admin/disk-usage')).json();
    assert.equal(disk.ok, true);
    assert.ok(disk.usage.driveTotal > 0);
  });

  test('feedback: download the zip, then delete exactly those files (and nothing outside the folder)', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'feedback-'));
    const s = await setUp(dir);
    t.after(s.close);
    writeFileSync(join(dir, '20261110-120000-abcdef.md'), '---\n---\n\nUwaga\n');
    writeFileSync(join(dir, 'notes.txt'), 'not a comment');
    const adam = await s.as('Adam');

    const zip = await adam.post('/api/admin/feedback/download', {});
    assert.equal(zip.headers['content-type'], 'application/zip');
    assert.match(zip.headers['content-disposition'] as string, /attachment; filename=uwagi-\d{8}-\d{6}\.zip/);
    const files = JSON.parse(zip.headers['x-feedback-files'] as string);
    assert.deepEqual(files, ['20261110-120000-abcdef.md']);

    const deleted = (await adam.postJson('/api/admin/feedback/delete', { files: [...files, '../evil.md', 'notes.txt'] })).json();
    assert.deepEqual(deleted, { ok: true, message: 'Pobrano i usunięto uwagi (1).' });
    assert.deepEqual(readdirSync(dir), ['notes.txt']);

    assert.equal((await (await s.as('Gracz')).post('/api/admin/feedback/download', {})).statusCode, 403);
  });
});
