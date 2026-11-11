// The action log page: rights, order, paging, filter, search, Polish time, escaping.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../src/db/database.ts';
import type { LogAction } from '../../src/db/queries/logs.ts';
import { toPolishTime } from '../../src/web/pages/admin/logs-view.ts';
import { addUser, createTestApp, TestBrowser } from '../helpers.ts';

async function setUp() {
  const t = await createTestApp();
  await t.app.ready();
  await addUser(t.db, 'Admin', 'Passw0rd!x', { role: 'admin' });
  await addUser(t.db, 'Zwykly', 'Passw0rd!x');
  return t;
}

async function logIn(t: { app: FastifyInstance }, name: string) {
  const browser = new TestBrowser(t.app);
  await browser.login(name, 'Passw0rd!x');
  return browser;
}

async function addLog(
  db: Db, at: string, o: { action?: LogAction; actor?: string | null; target?: string | null; details?: string | null } = {},
) {
  await db.insertInto('user_action_logs').values({
    created_utc: at, action: o.action ?? 'JoinedTable', actor_name: o.actor ?? null, actor_user_id: null,
    target_name: o.target ?? null, target_user_id: null, play_table_id: null, details: o.details ?? null,
  }).execute();
}

describe('/admin/logs', () => {
  test('logged out goes to login, a normal user is refused', async t => {
    const s = await setUp();
    t.after(s.close);

    const anon = await new TestBrowser(s.app).get('/admin/logs?q=a');
    assert.equal(anon.statusCode, 302);
    assert.equal(anon.headers.location, `/Account/Login?ReturnUrl=${encodeURIComponent('/admin/logs?q=a')}`);

    const user = await logIn(s, 'Zwykly');
    const denied = await user.get('/admin/logs');
    assert.equal(denied.statusCode, 302);
    assert.equal(denied.headers.location, '/Account/AccessDenied');
  });

  test('shows newest first and pages by 50', async t => {
    const s = await setUp();
    t.after(s.close);
    for (let i = 0; i < 120; i++) {
      await addLog(s.db, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), { details: `wpis-${String(i).padStart(3, '0')}` });
    }
    const admin = await logIn(s, 'Admin');

    const first = (await admin.get('/admin/logs')).body;
    assert.ok(first.includes('wpis-119'));
    assert.ok(first.indexOf('wpis-119') < first.indexOf('wpis-118'));
    assert.ok(first.includes('wpis-070'));
    assert.ok(!first.includes('wpis-069'));
    assert.ok(first.includes('Strona 1 z 3 (wpisów: 120)'));
    assert.ok(first.includes('href="/admin/logs?page=2"'));

    const third = (await admin.get('/admin/logs?page=3')).body;
    assert.ok(third.includes('wpis-019') && third.includes('wpis-000') && !third.includes('wpis-020'));
    assert.ok(third.includes('Strona 3 z 3'));
    assert.ok(third.includes('href="/admin/logs?page=2"'));

    // Out of range is clamped, garbage means the first page.
    assert.ok((await admin.get('/admin/logs?page=99')).body.includes('Strona 3 z 3'));
    assert.ok((await admin.get('/admin/logs?page=abc')).body.includes('Strona 1 z 3'));
  });

  test('filters by action and keeps the filter in the paging links', async t => {
    const s = await setUp();
    t.after(s.close);
    await addLog(s.db, '2026-01-01T10:00:00.000Z', { action: 'JoinedTable', details: 'dolaczenie' });
    await addLog(s.db, '2026-01-01T11:00:00.000Z', { action: 'RoleChanged', details: 'zmiana' });
    const admin = await logIn(s, 'Admin');

    const body = (await admin.get('/admin/logs?action=RoleChanged')).body;
    assert.ok(body.includes('zmiana') && !body.includes('dolaczenie'));
    assert.ok(body.includes('<option value="RoleChanged" selected>Zmiana roli</option>'));
    // An unknown action is ignored.
    const all = (await admin.get('/admin/logs?action=Nope')).body;
    assert.ok(all.includes('zmiana') && all.includes('dolaczenie'));
  });

  test('searches names and details; % and _ are literal', async t => {
    const s = await setUp();
    t.after(s.close);
    await addLog(s.db, '2026-01-01T10:00:00.000Z', { actor: 'Ania', details: 'Rola: 100% pewne' });
    await addLog(s.db, '2026-01-01T11:00:00.000Z', { actor: 'Basia', target: 'Kasia', details: 'inne_dane' });
    await addLog(s.db, '2026-01-01T12:00:00.000Z', { actor: 'Celina', details: 'innaXdane' });
    const admin = await logIn(s, 'Admin');

    const byTarget = (await admin.get('/admin/logs?q=kasia')).body;
    assert.ok(byTarget.includes('Basia') && !byTarget.includes('Ania'));
    const percent = (await admin.get(`/admin/logs?q=${encodeURIComponent('%')}`)).body;
    assert.ok(percent.includes('Ania') && !percent.includes('Basia'));
    const underscore = (await admin.get(`/admin/logs?q=${encodeURIComponent('inne_d')}`)).body;
    assert.ok(underscore.includes('Basia') && !underscore.includes('Celina'));
    const none = (await admin.get('/admin/logs?q=zzz')).body;
    assert.ok(none.includes('Brak wpisów.'));
  });

  test('times are shown in Polish time, summer and winter', () => {
    assert.equal(toPolishTime('2026-01-15T10:00:00.000Z'), '2026-01-15 11:00:00');
    assert.equal(toPolishTime('2026-07-15T10:00:00.000Z'), '2026-07-15 12:00:00');
    assert.equal(toPolishTime('2026-07-15T22:30:05.000Z'), '2026-07-16 00:30:05');
  });

  test('escapes names and details', async t => {
    const s = await setUp();
    t.after(s.close);
    await addLog(s.db, '2026-01-01T10:00:00.000Z', { actor: '<script>alert(1)</script>', details: '"x" & <b>' });
    const admin = await logIn(s, 'Admin');
    const body = (await admin.get(`/admin/logs?q=${encodeURIComponent('"><img')}`)).body;
    assert.ok(!body.includes('"><img'));
    const page = (await admin.get('/admin/logs')).body;
    assert.ok(!page.includes('<script>alert(1)'));
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(page.includes('&quot;x&quot; &amp; &lt;b&gt;'));
  });
});
