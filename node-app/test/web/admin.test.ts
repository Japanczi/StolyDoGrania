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

describe('renaming users (admin users page)', () => {
  test('an admin renames a regular user: normalised, seats follow, logged, login works with the new name', async t => {
    const s = await setUp();
    t.after(s.close);
    // Gracz holds a seat, so the board must show the new name too.
    const gameId = (await s.db.insertInto('games').values({ name: 'Gra', kind: 'small', weight: '0', max_players: 4, bgg_url: null, bgg_id: null, year_published: null, cover: null, cover_type: null }).returning('id').executeTakeFirstOrThrow()).id;
    const tableId = (await s.db.insertInto('play_tables').values({ game_id: gameId, game_title: null, start_hour: null, max_players: 4, kind: 'small', owner_user_id: null, taken_slots: 0 }).returning('id').executeTakeFirstOrThrow()).id;
    await s.db.insertInto('table_slots').values({ play_table_id: tableId, slot_number: 2, participant_name: 'Gracz', user_id: s.user.id }).execute();

    const adam = await s.as('Adam');
    assert.match((await adam.get(`/admin/users?zmien=${s.user.id}`)).body, new RegExp(`action="/admin/users/${s.user.id}/name"`));
    const res = await adam.post(`/admin/users/${s.user.id}/name`, { UserName: '  Nowy   Gracz ' });
    assert.equal(res.statusCode, 303);
    assert.match((await adam.get('/admin/users')).body, /Zmieniono nazwę użytkownika Gracz na Nowy Gracz\./);

    assert.equal((await findUserByUserName(s.db, 'nowy gracz'))?.id, s.user.id);
    const seat = await s.db.selectFrom('table_slots').select('participant_name').where('user_id', '=', s.user.id).executeTakeFirstOrThrow();
    assert.equal(seat.participant_name, 'Nowy Gracz');
    const log = await s.db.selectFrom('user_action_logs').select(['action', 'actor_name', 'target_name', 'details']).execute();
    assert.deepEqual(log, [{ action: 'UserRenamed', actor_name: 'Adam', target_name: 'Nowy Gracz', details: 'Gracz → Nowy Gracz' }]);
    assert.equal((await new TestBrowser(s.app).login('Nowy Gracz', 'haslo1')).statusCode, 303);
  });

  test('invalid or taken names are refused with the form kept open', async t => {
    const s = await setUp();
    t.after(s.close);
    const adam = await s.as('Adam');
    const bad = await adam.post(`/admin/users/${s.user.id}/name`, { UserName: 'x@y' });
    assert.match(bad.body, /Nazwa użytkownika: 3–20 znaków/);
    assert.match(bad.body, /value="x@y"/);
    const taken = await adam.post(`/admin/users/${s.user.id}/name`, { UserName: 'BEATA' });
    assert.match(taken.body, /Ta nazwa użytkownika jest już zajęta\./);
    assert.equal(await roleOf(s, 'Gracz'), 'user', 'unchanged');
  });

  test('same rules as roles: only the Owner renames admins; nobody renames the Owner or themselves here', async t => {
    const s = await setUp();
    t.after(s.close);
    const adam = await s.as('Adam');
    await adam.post(`/admin/users/${s.admin2.id}/name`, { UserName: 'Inna' });
    await adam.post(`/admin/users/${s.owner.id}/name`, { UserName: 'Inny' });
    await adam.post(`/admin/users/${s.admin.id}/name`, { UserName: 'Adam2' });
    assert.ok(await findUserByUserName(s.db, 'Beata'));
    assert.ok(await findUserByUserName(s.db, 'Szef'));
    assert.ok(await findUserByUserName(s.db, 'Adam'));
    assert.doesNotMatch((await adam.get('/admin/users')).body, new RegExp(`zmien=${s.admin2.id}`), 'no rename link for other admins');

    await (await s.as('Szef')).post(`/admin/users/${s.admin2.id}/name`, { UserName: 'Beata K' });
    assert.ok(await findUserByUserName(s.db, 'Beata K'));
    assert.equal((await (await s.as('Gracz')).post(`/admin/users/${s.user.id}/name`, { UserName: 'Hack' })).headers.location, '/Account/AccessDenied');
  });
});
