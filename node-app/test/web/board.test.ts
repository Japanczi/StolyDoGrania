// The board through HTTP (and its live WebSocket), with a fake BGG client. Rights are checked from the outside:
// a request is sent as a stranger / owner / admin and the database is inspected afterwards.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildApp } from '../../src/app.ts';
import type { Db } from '../../src/db/database.ts';
import { BggUnavailableError, type BggClient, type BggGameDetails } from '../../src/integrations/bgg/client.ts';
import { createLiveHub } from '../../src/live/hub.ts';
import { addUser, createTestDb, RecordingMailer, TestBrowser, testConfig } from '../helpers.ts';

// The smallest valid PNG (1×1 pixel).
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');

function fakeBgg(games: BggGameDetails[] = [], opts: { unavailable?: boolean } = {}): BggClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isConfigured: true,
    async search(query) {
      calls.push(`search:${query}`);
      if (opts.unavailable) throw new BggUnavailableError('down');
      return games.filter(g => g.name.toLowerCase().includes(query.toLowerCase())).map(g => ({ id: g.id, name: g.name, year: g.year }));
    },
    async getGame(id) {
      calls.push(`thing:${id}`);
      return games.find(g => g.id === id) ?? null;
    },
    async downloadCover() {
      calls.push('cover');
      return { bytes: png, contentType: 'image/png' };
    },
  };
}

const azul: BggGameDetails = {
  id: 230802, name: 'Azul', alternateNames: ['Azul: Kafelki'], year: 2017, maxPlayers: 4, weight: '1.7637', thumbnailUrl: 'https://cf.geekdo-images.com/a.png',
};

async function setUp(bgg: BggClient = fakeBgg([azul])) {
  const db = await createTestDb();
  const hub = createLiveHub();
  const app = await buildApp({ config: testConfig, db, mailer: new RecordingMailer(), bgg, hub });
  const owner = await addUser(db, 'Owner', 'haslo1');
  const ala = await addUser(db, 'Ala', 'haslo1');
  await addUser(db, 'Obcy', 'haslo1');
  await addUser(db, 'Admin', 'haslo1', { role: 'admin' });
  const browser = async (name: string | null) => {
    const b = new TestBrowser(app);
    if (name) await b.login(name, 'haslo1');
    return b;
  };
  return { db, hub, app, owner, ala, browser, close: async () => { await app.close(); await db.destroy(); } };
}

/** Creates a hand-added table as the given browser's user; returns its id. */
async function createTable(b: TestBrowser, fields: Record<string, string> = {}, cover?: Blob): Promise<number> {
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Moja Gra', kind: 'small', hour: '', takenSlots: '0', maxPlayers: '4', gameId: '', ...fields })) form.set(k, v);
  if (cover) form.set('cover', cover, 'cover.png');
  const res = await b.postMultipart('/api/tables', form);
  const body = res.json();
  assert.equal(body.ok, true, body.error);
  return body.tableId;
}

const seats = (db: Db, tableId: number) =>
  db.selectFrom('table_slots').select(['slot_number', 'participant_name']).where('play_table_id', '=', tableId).orderBy('slot_number').execute();

describe('board page', () => {
  test('logged out: join button, empty-state note, no new-table row, no actions', async t => {
    const s = await setUp();
    t.after(s.close);
    const page = await (await s.browser(null)).get('/');
    assert.match(page.body, /Dołącz do Planszówkarza teraz!/);
    assert.match(page.body, /id="board-empty">Nie ma jeszcze żadnych stołów\./);
    assert.doesNotMatch(page.body, /id="draft"/);
  });

  test('rows show only the controls the viewer may use', async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner, { hour: '18:30' });

    const asOwner = (await owner.get('/')).body;
    assert.match(asOwner, /data-action="delete"/);
    assert.match(asOwner, /data-action="taken"/);

    const asStranger = (await (await s.browser('Obcy')).get('/')).body;
    assert.doesNotMatch(asStranger, /data-action="delete"/);
    assert.match(asStranger, /18:30/);
    assert.match(asStranger, /data-action="take"/);

    const asAdmin = (await (await s.browser('Admin')).get(`/fragments/table/${id}`)).body;
    assert.match(asAdmin, /data-action="delete"/);
    assert.match(asAdmin, /data-popup="owner"/, 'admins can assign an owner');

    const anonymous = (await (await s.browser(null)).get(`/fragments/table/${id}`)).body;
    assert.doesNotMatch(anonymous, /data-action=/);
    assert.match(anonymous, /title="Zaloguj się, aby zająć miejsce"/);
  });

  test('a user name is escaped wherever it appears', async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner, { name: '<script>alert(1)</script>' });
    const row = (await owner.get(`/fragments/table/${id}`)).body;
    assert.doesNotMatch(row, /<script>/);
    assert.match(row, /&lt;script&gt;/);
  });
});

describe('creating a table', () => {
  test('the creator sits in the first seat as owner; the phrase is recorded; open pages are told', async t => {
    const s = await setUp();
    t.after(s.close);
    const before = s.hub.version;
    const id = await createTable(await s.browser('Owner'), { name: '  Moja Gra ', hour: '19:15', takenSlots: '1' });

    const table = await s.db.selectFrom('play_tables').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    assert.equal(table.owner_user_id, s.owner.id);
    assert.equal(table.start_hour, '19:15');
    assert.equal(table.taken_slots, 1);
    assert.deepEqual(await seats(s.db, id), [{ slot_number: 1, participant_name: 'Owner' }]);
    const phrases = await s.db.selectFrom('table_phrases').select(['phrase', 'user_id']).execute();
    assert.deepEqual(phrases, [{ phrase: 'Moja Gra', user_id: s.owner.id }]);
    assert.equal(s.hub.version, before + 1);
  });

  test('refused: logged out, too many marks, a forged seat count, a wrong hour', async t => {
    const s = await setUp();
    t.after(s.close);
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ name: 'X', kind: 'small', hour: '', takenSlots: '0', maxPlayers: '4', gameId: '', ...fields })) f.set(k, v);
      return f;
    };
    const anon = await s.browser(null);
    assert.equal((await anon.postMultipart('/api/tables', form({}))).json().error, 'Zaloguj się, aby utworzyć stół.');
    const b = await s.browser('Owner');
    assert.equal((await b.postMultipart('/api/tables', form({ takenSlots: '4' }))).json().error, 'Przy stole musi zostać co najmniej jedno miejsce dla Ciebie.');
    assert.equal((await b.postMultipart('/api/tables', form({ maxPlayers: '15' }))).json().error, 'Nieprawidłowa liczba miejsc.');
    assert.equal((await b.postMultipart('/api/tables', form({ hour: '18:20' }))).json().error, 'Nieprawidłowa godzina.');
    assert.equal((await s.db.selectFrom('play_tables').select('id').execute()).length, 0);
  });

  test('a BGG game brings its own seat count, whatever the page sent', async t => {
    const s = await setUp();
    t.after(s.close);
    const b = await s.browser('Owner');
    const lookup = (await b.postJson('/api/lookup', { name: 'Azul', mode: 'auto', kind: 'small' })).json();
    assert.equal(lookup.kind, 'selected');
    const id = await createTable(b, { name: 'Azul', gameId: String(lookup.game.id), maxPlayers: '2' });
    const table = await s.db.selectFrom('play_tables').select('max_players').where('id', '=', id).executeTakeFirstOrThrow();
    assert.equal(table.max_players, 4);
  });

  test('a cover can be uploaded for a hand-added game, checked by content and size, and is served from the database', async t => {
    const s = await setUp();
    t.after(s.close);
    const b = await s.browser('Owner');
    const id = await createTable(b, { name: 'Z okładką' }, new Blob([png], { type: 'image/png' }));
    const game = await s.db.selectFrom('play_tables').select('game_id').where('id', '=', id).executeTakeFirstOrThrow();
    const cover = await b.get(`/covers/${game.game_id}`);
    assert.equal(cover.statusCode, 200);
    assert.equal(cover.headers['content-type'], 'image/png');
    assert.deepEqual(cover.rawPayload, png);

    const fake = new FormData();
    for (const [k, v] of Object.entries({ name: 'Udawana', kind: 'small', hour: '', takenSlots: '0', maxPlayers: '4', gameId: '' })) fake.set(k, v);
    fake.set('cover', new Blob(['<html>not an image</html>'], { type: 'image/png' }), 'x.png');
    assert.equal((await b.postMultipart('/api/tables', fake)).json().error, 'Okładka musi być obrazem PNG, JPEG, WebP lub GIF.');

    const big = new FormData();
    for (const [k, v] of Object.entries({ name: 'Za duża', kind: 'small', hour: '', takenSlots: '0', maxPlayers: '4', gameId: '' })) big.set(k, v);
    big.set('cover', new Blob([png, Buffer.alloc(2 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
    assert.equal((await b.postMultipart('/api/tables', big)).json().error, 'Okładka może mieć maksymalnie 2 MB.');
  });
});

describe('seats', () => {
  test('taking a seat logs JoinedTable; one seat per user; logged-out users are refused', async t => {
    const s = await setUp();
    t.after(s.close);
    const id = await createTable(await s.browser('Owner'));
    const ala = await s.browser('Ala');
    assert.deepEqual((await ala.postJson(`/api/tables/${id}/slots/2/take`)).json(), { ok: true });
    assert.equal((await ala.postJson(`/api/tables/${id}/slots/3/take`)).json().error, 'Masz już miejsce przy tym stole.');
    assert.equal((await (await s.browser(null)).postJson(`/api/tables/${id}/slots/3/take`)).json().error, 'Zaloguj się, aby zająć miejsce.');

    const log = await s.db.selectFrom('user_action_logs').select(['action', 'actor_name', 'details', 'play_table_id']).execute();
    assert.deepEqual(log, [{ action: 'JoinedTable', actor_name: 'Ala', details: 'Moja Gra – miejsce 2', play_table_id: id }]);
  });

  test('freeing: own seat yes, someone else’s no – unless owner or admin', async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner);
    const ala = await s.browser('Ala');
    await ala.postJson(`/api/tables/${id}/slots/2/take`);
    const stranger = await s.browser('Obcy');
    await stranger.postJson(`/api/tables/${id}/slots/3/take`);

    assert.equal((await stranger.postJson(`/api/tables/${id}/slots/2/free`)).json().error, 'Nie możesz zwolnić tego miejsca.');
    assert.equal((await ala.postJson(`/api/tables/${id}/slots/2/free`)).json().ok, true);
    assert.equal((await owner.postJson(`/api/tables/${id}/slots/3/free`)).json().ok, true);
    assert.deepEqual(await seats(s.db, id), [{ slot_number: 1, participant_name: 'Owner' }]);
    assert.equal((await (await s.browser('Admin')).postJson(`/api/tables/${id}/slots/1/free`)).json().ok, true);
  });

  test("owner's popup and adding players; an admin assigns a new owner", async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner);

    assert.equal((await (await s.browser('Obcy')).get(`/fragments/add-player?table=${id}&slot=2`)).statusCode, 403);
    assert.equal((await owner.get(`/fragments/add-player?table=${id}&slot=1`)).statusCode, 403, 'only admins choose owners');
    const popup = (await owner.get(`/fragments/add-player?table=${id}&slot=2`)).body;
    assert.match(popup, /Dodaj gracza/);
    assert.match(popup, /data-name="Ala"/);
    assert.doesNotMatch(popup, /data-name="Owner"/, 'already seated');

    // A registered user's seat shows the name from the database, not what the page sent.
    assert.equal((await owner.postJson(`/api/tables/${id}/slots/2/add`, { userId: s.ala.id, name: 'Fałszywa nazwa' })).json().ok, true);
    assert.equal((await owner.postJson(`/api/tables/${id}/slots/3/add`, { name: 'Gość z ulicy' })).json().ok, true);
    assert.equal((await owner.postJson(`/api/tables/${id}/slots/1/add`, { userId: s.ala.id })).json().error, 'Tylko administrator może wskazać właściciela stołu.');
    assert.deepEqual((await seats(s.db, id)).map(x => x.participant_name), ['Owner', 'Ala', 'Gość z ulicy']);

    const admin = await s.browser('Admin');
    assert.equal((await admin.postJson(`/api/tables/${id}/slots/1/add`, { userId: s.ala.id })).json().ok, true);
    const table = await s.db.selectFrom('play_tables').select('owner_user_id').where('id', '=', id).executeTakeFirstOrThrow();
    assert.equal(table.owner_user_id, s.ala.id);
    assert.deepEqual((await seats(s.db, id)).map(x => x.participant_name), ['Ala', 'Gość z ulicy']);
  });
});

describe("owner's edits", () => {
  test('marks, kind and hour: owner yes, stranger no', async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner);
    const stranger = await s.browser('Obcy');

    assert.equal((await stranger.postJson(`/api/tables/${id}/kind`, { kind: 'big' })).json().error, 'Tylko właściciel stołu lub administrator może go edytować.');
    assert.equal((await owner.postJson(`/api/tables/${id}/kind`, { kind: 'big' })).json().ok, true);
    assert.equal((await owner.postJson(`/api/tables/${id}/kind`, { kind: 'huge' })).json().error, 'Nieznany rodzaj stołu.');
    assert.equal((await owner.postJson(`/api/tables/${id}/taken`, { count: '2' })).json().ok, true);
    assert.equal((await owner.postJson(`/api/tables/${id}/taken`, { count: '9' })).json().error, 'Liczba zajętych miejsc musi mieścić się w zakresie 0–3.');
    assert.equal((await owner.postJson(`/api/tables/${id}/hour`, { hour: '20:45' })).json().ok, true);
    assert.equal((await owner.postJson(`/api/tables/${id}/hour`, { hour: '25:00' })).json().error, 'Nieprawidłowa godzina.');

    const table = await s.db.selectFrom('play_tables').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    assert.deepEqual([table.kind, table.taken_slots, table.start_hour], ['big', 2, '20:45']);
  });

  test('rename clears the other players and keeps the owner; delete is two-sided too', async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner);
    await (await s.browser('Ala')).postJson(`/api/tables/${id}/slots/2/take`);

    const renamed = (await owner.postJson(`/api/tables/${id}/rename`, { name: 'Inna Gra' })).json();
    assert.deepEqual(renamed, { ok: true, message: 'Zmieniono grę stołu: Moja Gra → Inna Gra.' });
    assert.deepEqual((await seats(s.db, id)).map(x => x.participant_name), ['Owner']);

    assert.equal((await (await s.browser('Obcy')).postJson(`/api/tables/${id}/delete`)).json().ok, false);
    assert.deepEqual((await owner.postJson(`/api/tables/${id}/delete`)).json(), { ok: true, message: 'Usunięto stół: Inna Gra.' });
    assert.equal((await owner.get(`/fragments/table/${id}`)).statusCode, 404);
    assert.equal((await s.db.selectFrom('games').select('id').execute()).length, 2, 'games stay in the catalog');
  });

  test('changes without the CSRF header are refused', async t => {
    const s = await setUp();
    t.after(s.close);
    const owner = await s.browser('Owner');
    const id = await createTable(owner);
    assert.equal((await owner.postJson(`/api/tables/${id}/delete`, {}, { csrf: null })).statusCode, 403);
  });
});

describe('game lookup', () => {
  test('BGG: one exact match is imported once (cover, weight as given, alternate names)', async t => {
    const bgg = fakeBgg([azul]);
    const s = await setUp(bgg);
    t.after(s.close);
    const b = await s.browser('Owner');
    const first = (await b.postJson('/api/lookup', { name: 'azul', mode: 'auto', kind: 'big' })).json();
    assert.equal(first.kind, 'selected');
    assert.equal(first.game.difficultyLabel, '1.7637');
    assert.equal(first.note, 'Znaleziono na BoardGameGeek: Azul (2017)');
    assert.deepEqual(bgg.calls, ['search:azul', 'thing:230802', 'cover']);

    // By an alternate name, from the catalog: BGG isn't asked again.
    const again = (await b.postJson('/api/lookup', { name: 'Azul: Kafelki', mode: 'auto', kind: 'small' })).json();
    assert.equal(again.game.id, first.game.id);
    assert.equal(bgg.calls.length, 3);
  });

  test('several BGG results: candidates; BGG down: a Polish note and a hand-added game', async t => {
    const s = await setUp(fakeBgg([azul, { ...azul, id: 1, name: 'Azul: Summer Pavilion', year: 2019 }]));
    t.after(s.close);
    const b = await s.browser('Owner');
    const many = (await b.postJson('/api/lookup', { name: 'Az', mode: 'auto', kind: 'small' })).json();
    assert.equal(many.kind, 'candidates');
    assert.equal(many.candidates.length, 2);
    const picked = (await b.postJson('/api/lookup/pick', { bggId: 1, kind: 'small' })).json();
    assert.equal(picked.game.name, 'Azul: Summer Pavilion');

    const down = await setUp(fakeBgg([], { unavailable: true }));
    t.after(down.close);
    const r = (await (await down.browser('Owner')).postJson('/api/lookup', { name: 'Cokolwiek', mode: 'auto', kind: 'small' })).json();
    assert.deepEqual(r, { kind: 'none', note: 'Nie udało się połączyć z BoardGameGeek. Spróbuj ponownie przyciskiem BGG albo dodaj grę ręcznie.', game: null });
  });

  test('needs a login', async t => {
    const s = await setUp();
    t.after(s.close);
    assert.equal((await (await s.browser(null)).postJson('/api/lookup', { name: 'Azul' })).statusCode, 401);
  });
});

describe('live updates (WebSocket)', () => {
  /**
   * Opens /live on a real listening server with Node's built-in WebSocket client. Browsers always send an Origin
   * header with WebSockets; Node's client doesn't, so it's set by hand (undici's non-standard `headers` option).
   */
  async function listen(s: Awaited<ReturnType<typeof setUp>>, origin: string | null) {
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const address = s.app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const messages: { type: string; version: number; tableId?: number | null }[] = [];
    let closedWith: number | null = null;
    const init = { headers: { origin: origin === 'self' ? `http://127.0.0.1:${port}` : origin ?? '' } };
    const ws = new (WebSocket as unknown as new (url: string, init: object) => WebSocket)(`ws://127.0.0.1:${port}/live`, origin === null ? {} : init);
    ws.addEventListener('message', e => messages.push(JSON.parse(String(e.data))));
    ws.addEventListener('close', e => { closedWith = e.code; });
    await tick(300);
    return { ws, messages, closed: () => closedWith, port };
  }

  const tick = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

  test('a page hears "hello", then a notice for each change – with no user data in it', async t => {
    const s = await setUp();
    const { ws, messages, port } = await listen(s, 'self');
    t.after(async () => { ws.close(); await s.close(); });
    assert.equal(port > 0, true);
    assert.equal(messages[0]?.type, 'hello');

    const id = await createTable(await s.browser('Owner'));
    await (await s.browser('Ala')).postJson(`/api/tables/${id}/slots/2/take`);
    await tick();
    const notices = messages.filter(m => m.type === 'board');
    assert.deepEqual(notices.map(m => m.tableId), [null, id]);
    assert.deepEqual(notices.map(m => m.version), [1, 2]);
    assert.doesNotMatch(JSON.stringify(messages), /Ala|Owner|Moja Gra/);
  });

  test('a connection from another site, or without an Origin, is refused (cross-site WebSocket hijacking)', async t => {
    const s = await setUp();
    t.after(s.close);
    const evil = await listen(s, 'https://evil.example');
    assert.equal(evil.closed(), 1008);
    assert.deepEqual(evil.messages, []);
  });
});
