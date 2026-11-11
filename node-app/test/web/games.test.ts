// "Baza gier" (/gry) through HTTP: listing, search, sorting, creating a table, deleting a game, rights and CSRF.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildApp } from '../../src/app.ts';
import type { Db } from '../../src/db/database.ts';
import { createLiveHub } from '../../src/live/hub.ts';
import { addUser, createTestDb, RecordingMailer, TestBrowser, testConfig } from '../helpers.ts';

async function addGame(db: Db, name: string, opts: { maxPlayers?: number; weight?: string; kind?: 'small' | 'big' | 'other'; alt?: string[] } = {}): Promise<number> {
  const row = await db.insertInto('games').values({
    name, kind: opts.kind ?? 'small', weight: opts.weight ?? '0', max_players: opts.maxPlayers ?? 4, bgg_url: null, bgg_id: null,
    year_published: null, cover: null, cover_type: null,
  }).returning('id').executeTakeFirstOrThrow();
  for (const alt of opts.alt ?? []) {
    await db.insertInto('game_alternate_names').values({ game_id: row.id, name: alt }).execute();
  }
  return row.id;
}

async function setUp() {
  const db = await createTestDb();
  const hub = createLiveHub();
  const app = await buildApp({ config: { ...testConfig, logLevel: 'error' }, db, mailer: new RecordingMailer(), hub });
  await app.ready();
  await addUser(db, 'Ala', 'haslo1');
  await addUser(db, 'Admin', 'haslo1', { role: 'admin' });
  const browser = async (name: string | null) => {
    const b = new TestBrowser(app);
    if (name) await b.login(name, 'haslo1');
    return b;
  };
  return { app, db, hub, browser };
}

/** Names of the games in page order. */
function names(page: string): string[] {
  return [...page.matchAll(/<span class="game-name">([^<]*)<\/span>/g)].map(m => m[1] ?? '');
}

describe('Baza gier', () => {
  test('lists games for everyone, escaped, with the empty state', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const guest = await browser(null);

    assert.match((await guest.get('/gry')).body, /Katalog gier jest pusty/);

    await addGame(db, '<b>Azul</b> & "Co"', { weight: '1.7637', maxPlayers: 4 });
    const page = (await guest.get('/gry')).body;
    assert.match(page, /<title>Baza gier/);
    assert.ok(page.includes('&lt;b&gt;Azul&lt;/b&gt;'));
    assert.ok(!page.includes('<b>Azul</b>'));
    assert.match(page, /1 gra/);
    assert.match(page, /1\.7637/);
    assert.match(page, /thumb-placeholder/);
    // Logged out: a link to log in, no create form and no delete.
    assert.match(page, /href="\/Account\/Login\?ReturnUrl=%2Fgry"/);
    assert.doesNotMatch(page, /create-table/);
    assert.doesNotMatch(page, /data-confirm-delete/);
  });

  test('search matches alternate names (which are not shown)', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    await addGame(db, 'Azul', { alt: ['Azul: Kafelki'] });
    await addGame(db, 'Catan');
    const b = await browser(null);

    const page = (await b.get('/gry?q=kafelki')).body;
    assert.deepEqual(names(page), ['Azul']);
    assert.ok(!page.includes('Kafelki</span>'));
    assert.match(page, /1 z 2/);
    assert.deepEqual(names((await b.get('/gry?q=CAT')).body), ['Catan']);
    assert.match((await b.get('/gry?q=nic')).body, /Brak gier pasujących do „nic”/);
  });

  test('sorts by column and direction, ties by name', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    await addGame(db, 'Bravo', { maxPlayers: 4, weight: '3' });
    await addGame(db, 'Alfa', { maxPlayers: 4, weight: '1' });
    await addGame(db, 'Charlie', { maxPlayers: 2, weight: '2' });
    const b = await browser(null);

    assert.deepEqual(names((await b.get('/gry')).body), ['Alfa', 'Bravo', 'Charlie']);
    assert.deepEqual(names((await b.get('/gry?sort=name&dir=desc')).body), ['Charlie', 'Bravo', 'Alfa']);
    assert.deepEqual(names((await b.get('/gry?sort=players')).body), ['Charlie', 'Alfa', 'Bravo']);
    assert.deepEqual(names((await b.get('/gry?sort=players&dir=desc')).body), ['Alfa', 'Bravo', 'Charlie']);
    assert.deepEqual(names((await b.get('/gry?sort=difficulty&dir=desc')).body), ['Bravo', 'Charlie', 'Alfa']);
    // Unknown values fall back to the defaults.
    assert.deepEqual(names((await b.get('/gry?sort=evil&dir=x')).body), ['Alfa', 'Bravo', 'Charlie']);
    // The active header links to the opposite direction.
    assert.match((await b.get('/gry?sort=players')).body, /href="\/gry\?sort=players&amp;dir=desc"/);
  });

  test('"Utwórz stół" seats the creator as owner, records the phrase and redirects to the board', async t => {
    const { app, db, hub, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const id = await addGame(db, 'Catan', { maxPlayers: 4, kind: 'big' });
    const ala = await browser('Ala');
    const before = hub.version;

    assert.match((await ala.get('/gry')).body, /action="\/gry\/\d+\/create-table"/);
    const res = await ala.post(`/gry/${id}/create-table`, {});
    assert.equal(res.statusCode, 303);
    const table = await db.selectFrom('play_tables').selectAll().executeTakeFirstOrThrow();
    assert.equal(res.headers.location, `/?nowy=${table.id}`);
    assert.equal(table.game_id, id);
    assert.equal(table.game_title, 'Catan');
    assert.equal(table.kind, 'big');
    assert.equal(table.max_players, 4);
    assert.equal(table.start_hour, null);
    assert.equal(table.taken_slots, 0);

    const slots = await db.selectFrom('table_slots').selectAll().execute();
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.slot_number, 1);
    assert.equal(slots[0]?.user_id, table.owner_user_id);
    const phrase = await db.selectFrom('table_phrases').selectAll().executeTakeFirstOrThrow();
    assert.equal(phrase.phrase, 'Catan');
    assert.equal(phrase.game_id, id);
    assert.ok(hub.version > before, 'the live hub was told');
    assert.match((await ala.get(res.headers.location as string)).body, /Utworzono stół: Catan\./);
  });

  test('a game with no seat count gets 1–6; one over the limit is refused', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const empty = await addGame(db, 'Zero', { maxPlayers: 0 });
    const huge = await addGame(db, 'Huge', { maxPlayers: 21 });
    const ala = await browser('Ala');

    assert.equal((await ala.post(`/gry/${empty}/create-table`, {})).statusCode, 303);
    const table = await db.selectFrom('play_tables').selectAll().executeTakeFirstOrThrow();
    assert.ok(table.max_players >= 1 && table.max_players <= 6);

    const refused = await ala.post(`/gry/${huge}/create-table`, {});
    assert.equal(refused.headers.location, '/gry');
    assert.equal((await db.selectFrom('play_tables').select('id').execute()).length, 1);
    assert.match((await ala.get('/gry')).body, /Nie można tworzyć stołów dla gier z więcej niż 20 miejscami\./);
  });

  test('logged-out users cannot create tables', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const id = await addGame(db, 'Catan');
    const guest = await browser(null);

    const res = await guest.post(`/gry/${id}/create-table`, {});
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/gry');
    assert.equal((await db.selectFrom('play_tables').select('id').execute()).length, 0);
    assert.match((await guest.get('/gry')).body, /Zaloguj się, aby utworzyć stół\./);
  });

  test('only an admin deletes a game, and its alternate names go with it', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const id = await addGame(db, 'Azul', { alt: ['Azul: Kafelki'] });
    const guest = await browser(null);
    const ala = await browser('Ala');
    const admin = await browser('Admin');

    assert.doesNotMatch((await ala.get('/gry')).body, /data-confirm-delete/);
    assert.equal((await guest.post(`/gry/${id}/delete`, {})).statusCode, 403);
    assert.equal((await ala.post(`/gry/${id}/delete`, {})).statusCode, 403);
    assert.equal((await db.selectFrom('games').select('id').execute()).length, 1);

    assert.match((await admin.get('/gry')).body, /data-confirm-delete/);
    const res = await admin.post(`/gry/${id}/delete`, { q: 'az', sort: 'players', dir: 'desc' });
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/gry?q=az&sort=players&dir=desc');
    assert.equal((await db.selectFrom('games').select('id').execute()).length, 0);
    assert.equal((await db.selectFrom('game_alternate_names').select('name').execute()).length, 0);
    assert.match((await admin.get('/gry')).body, /Usunięto grę: Azul\./);
  });

  test('a game used by a table cannot be deleted', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const id = await addGame(db, 'Catan');
    const ala = await browser('Ala');
    const admin = await browser('Admin');
    await ala.post(`/gry/${id}/create-table`, {});

    const page = (await admin.get('/gry')).body;
    assert.match(page, /data-confirm-delete[^>]*disabled/);
    await admin.post(`/gry/${id}/delete`, {});
    assert.equal((await db.selectFrom('games').select('id').execute()).length, 1);
    assert.match((await admin.get('/gry')).body, /Nie można usunąć gry „Catan”, bo są przy niej stoły\./);
  });

  test('POSTs need the CSRF token', async t => {
    const { app, db, browser } = await setUp();
    t.after(async () => { await app.close(); await db.destroy(); });
    const id = await addGame(db, 'Catan');
    const ala = await browser('Ala');
    const admin = await browser('Admin');

    assert.equal((await ala.post(`/gry/${id}/create-table`, {}, { csrf: null })).statusCode, 403);
    assert.equal((await admin.post(`/gry/${id}/delete`, {}, { csrf: null })).statusCode, 403);
    assert.equal((await db.selectFrom('play_tables').select('id').execute()).length, 0);
    assert.equal((await db.selectFrom('games').select('id').execute()).length, 1);
  });
});
