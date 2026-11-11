// Port of Planszowkarz.Tests/SheetImportTests.cs (parser, applyImport, sync) plus the job and board-edit checks.
// TEMPORARY like src/import/: delete together with it.

import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';
import { openDatabase, type Db } from '../../src/db/database.ts';
import { migrateToLatest } from '../../src/db/migrator.ts';
import { editTable, loadBoard } from '../../src/db/queries/board.ts';
import { freeSlots, tryTakeSlot, type PlayTable } from '../../src/domain/play-table.ts';
import { applyImport } from '../../src/import/apply-import.ts';
import { syncSheet } from '../../src/import/board-sync.ts';
import { startSheetImport, type SheetImportDeps } from '../../src/import/sheet-import-job.ts';
import { keysFor, parseSheet, SheetFormatError, type SheetTableRow } from '../../src/import/sheet-parser.ts';

// Shaped like the real feed (2026-11-08), cut down to the columns and rows the tests need.
const feed = `/*O_o*/
google.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","table":{"cols":[
{"id":"A","label":"Tytul","type":"string"},{"id":"B","label":"Zajęte","type":"number"},{"id":"C","label":"Stół","type":"string"},
{"id":"D","label":"Start","type":"datetime"},{"id":"E","label":"Max","type":"number"},{"id":"F","label":"BGG","type":"string"},
{"id":"G","label":"Waga","type":"number"},{"id":"H","label":"Okładka","type":"string"},
{"id":"I","label":"Slot 1","type":"string"},{"id":"J","label":"Slot 2","type":"string"},{"id":"K","label":"Slot 3","type":"string"},
{"id":"L","label":"Slot 4","type":"string"},{"id":"M","label":"Slot 5","type":"string"},{"id":"N","label":"","type":"string"}],
"rows":[
{"c":[{"v":"Splendor marvel"},{"v":3.0,"f":"3"},{"v":"Mały"},{"v":"Date(1899,11,30,18,0,0)","f":"18:00"},{"v":4.0,"f":"4"},{"v":"Link"},{"v":1.7966,"f":"1,80"},null,{"v":"Zajęte"},{"v":"Zajęte"},{"v":"Zajęte"},{"v":"WOLNE"},null,{"v":"uwagi"}]},
{"c":[{"v":"Grimcoven "},null,{"v":"Duży"},null,{"v":5.0,"f":"5"},{"v":"Link"},{"v":3.7432,"f":"3,74"},null,{"v":"Patryk Czaja"},{"v":"Krzysztof P."},{"v":"Paweł D."},{"v":"WOLNE"},{"v":"WOLNE"},null]},
{"c":[null,null,null,null,null,null,null,null,null,null,null,null,null,null]},
{"c":[{"v":"Bez max"},null,{"v":"Inny"},null,null,null,null,null,{"v":"Ala"},null,{"v":"Ola"},null,null,null]}
]},"parsedNumHeaders":1});`;

function row(title: string, max = 4, taken = 0, start: string | null = null, ...players: [number, string][]): SheetTableRow {
  return { title, kind: 'small', start, maxPlayers: max, weight: '2.5', takenSlots: taken, players: new Map(players) };
}

function slotsOf(table: Pick<PlayTable, 'participants'>): Record<number, string> {
  return Object.fromEntries(table.participants.map(p => [p.slotNumber, p.participantName]));
}

async function createDb(t: TestContext): Promise<Db> {
  const db = openDatabase(':memory:');
  t.after(() => db.destroy());
  await migrateToLatest(db);
  return db;
}

async function addUserRow(db: Db, id: string): Promise<void> {
  await db.insertInto('users').values({
    id, user_name: id, normalized_user_name: id.toUpperCase(), email: `${id}@example.com`,
    normalized_email: `${id}@example.com`.toUpperCase(), email_confirmed: 1, password_hash: null, phone_number: null,
    role: 'user', access_failed_count: 0, lockout_end_utc: null, created_utc: new Date().toISOString(),
  }).execute();
}

describe('sheet parser', () => {
  test('reads columns by label', () => {
    const rows = parseSheet(feed);
    assert.equal(rows.length, 3, 'the empty row is skipped');

    const [splendor, grimcoven] = rows;
    assert.ok(splendor && grimcoven);
    assert.equal(splendor.title, 'Splendor marvel');
    assert.equal(splendor.kind, 'small');
    assert.equal(splendor.start, '18:00');
    assert.equal(splendor.maxPlayers, 4);
    assert.equal(splendor.weight, '1.7966', 'the raw value, not the rounded "1,80"');
    assert.equal(splendor.takenSlots, 3);
    assert.equal(splendor.players.size, 0);

    assert.equal(grimcoven.title, 'Grimcoven');
    assert.equal(grimcoven.kind, 'big');
    assert.equal(grimcoven.start, null);
    assert.equal(grimcoven.takenSlots, 0);
    assert.deepEqual([...grimcoven.players].sort((a, b) => a[0] - b[0]).map(p => p[1]), ['Patryk Czaja', 'Krzysztof P.', 'Paweł D.']);
  });

  test('without Max, counts up to the last filled seat', () => {
    const r = parseSheet(feed)[2];
    assert.ok(r);
    assert.equal(r.kind, 'other');
    assert.equal(r.maxPlayers, 3);
    assert.equal(r.players.get(3), 'Ola');
  });

  for (const response of [
    '{"status":"error"}',
    '{"status":"ok","table":{"cols":[{"label":"Odpowiedzi"}],"rows":[]}}', // another tab
    'not json',
  ]) {
    test(`rejects what is not the sign-up sheet: ${response}`, () => {
      assert.throws(() => parseSheet(response), SheetFormatError);
    });
  }

  test('keysFor numbers repeated titles', () => {
    assert.deepEqual(keysFor([row('Catan'), row(' catan '), row('Azul')]), ['catan#1', 'catan#2', 'azul#1']);
  });
});

describe('applyImport', () => {
  function imported(r: SheetTableRow): PlayTable {
    const table: PlayTable = {
      id: 1, gameId: 1, gameTitle: null, startHour: null, maxPlayers: 1, kind: 'small', ownerUserId: null, takenSlots: 0, participants: [],
    };
    applyImport(table, r);
    return table;
  }

  test('copies the row', () => {
    const table = imported(row('Catan', 4, 1, '18:00', [1, 'Ala'], [2, 'Ola']));
    assert.equal(table.gameTitle, 'Catan');
    assert.equal(table.maxPlayers, 4);
    assert.equal(table.startHour, '18:00');
    assert.equal(table.takenSlots, 1);
    assert.ok(table.participants.every(p => p.isImported === true));
    assert.equal(freeSlots(table), 1);
  });

  test('removes players gone from the sheet, keeps app players', () => {
    const table = imported(row('Catan', 4, 0, null, [1, 'Ala'], [2, 'Ola']));
    assert.ok(tryTakeSlot(table, 3, 'Janek', 'janek').ok);

    applyImport(table, row('Catan', 4, 0, null, [1, 'Ala']));

    assert.deepEqual(slotsOf(table), { 1: 'Ala', 3: 'Janek' });
    assert.notEqual(table.participants.find(p => p.slotNumber === 3)?.isImported, true);
  });

  test('moves an app player when the sheet takes their seat', () => {
    const table = imported(row('Catan', 4, 0, null, [1, 'Ala']));
    assert.ok(tryTakeSlot(table, 2, 'Janek', 'janek').ok);

    const dropped = applyImport(table, row('Catan', 4, 0, null, [1, 'Ala'], [2, 'Ola']));

    assert.deepEqual(dropped, []);
    assert.equal(slotsOf(table)[2], 'Ola');
    assert.equal(slotsOf(table)[3], 'Janek');
    assert.equal(table.participants.find(p => p.slotNumber === 3)?.userId, 'janek');
  });

  test('drops an app player when the table is full, and clamps the marks', () => {
    const table = imported(row('Catan', 2, 0, null, [1, 'Ala']));
    assert.ok(tryTakeSlot(table, 2, 'Janek', 'janek').ok);

    const dropped = applyImport(table, row('Catan', 2, 1, null, [1, 'Ala'], [2, 'Ola']));

    assert.deepEqual(dropped, ['Janek']);
    assert.equal(table.participants.length, 2);
    assert.equal(table.takenSlots, 0, 'no free seat left to mark');
  });

  // C#'s ApplyImport_KeepsDateWhenHourIsUnchanged has no counterpart: the Node app stores only the hour.
  test('an unchanged hour stays, a changed one is copied', () => {
    const table = imported(row('Catan', 4, 0, '18:00'));
    applyImport(table, row('Catan', 4, 0, '18:00'));
    assert.equal(table.startHour, '18:00');
    applyImport(table, row('Catan', 4, 0, null));
    assert.equal(table.startHour, null);
  });
});

describe('sheet sync', () => {
  test('mirrors the sheet and leaves app data alone', async t => {
    const db = await createDb(t);
    await addUserRow(db, 'owner');
    await addUserRow(db, 'janek');

    // App data: a BGG game with its own table, and a hand-added game without a weight.
    const catan = await db.insertInto('games').values({ name: 'Catan', kind: 'small', weight: '2.3', max_players: 4, bgg_id: 13 })
      .returning('id').executeTakeFirstOrThrow();
    await db.insertInto('games').values({ name: 'Azul', kind: 'small', weight: '0', max_players: 4 }).execute();
    const appTable = await db.insertInto('play_tables').values({
      game_id: catan.id, game_title: 'Catan', start_hour: null, max_players: 4, kind: 'small', owner_user_id: 'owner', taken_slots: 0,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('table_slots').values({ play_table_id: appTable.id, slot_number: 1, participant_name: 'Owner', user_id: 'owner' }).execute();

    const first = await syncSheet(db, [
      row('catan', 3, 0, null, [1, 'Ala']),
      row('Azul', 4, 0, null, [1, 'Ola']),
      row('Recall', 4, 0, null, [1, 'Ela']),
    ]);
    assert.equal(first.added, 3);
    assert.equal(first.changed, true);

    // Existing games are reused (Catan unchanged; Azul only gets the missing weight); Recall is new.
    const games = await db.selectFrom('games').select(['name', 'weight', 'is_from_sheet']).orderBy('name').execute();
    assert.deepEqual(games.map(g => g.name), ['Azul', 'Catan', 'Recall']);
    assert.equal(games[0]?.weight, '2.5');
    assert.equal(games[1]?.weight, '2.3');
    assert.equal(games[2]?.is_from_sheet, 1);

    // An app user joins the imported Recall table (through the board's own edit path).
    const recallId = (await loadBoard(db)).find(b => b.gameTitle === 'Recall')?.id;
    assert.ok(recallId !== undefined);
    assert.ok((await editTable(db, recallId, table => tryTakeSlot(table, 2, 'Janek', 'janek'))).ok);

    // Azul disappears from the sheet; Recall gains a player in Janek's seat.
    const second = await syncSheet(db, [
      row('catan', 3, 0, null, [1, 'Ala']),
      row('Recall', 4, 0, null, [1, 'Ela'], [2, 'Ula']),
    ]);
    assert.deepEqual([second.added, second.updated, second.removed], [0, 2, 1]);

    const board = await loadBoard(db);
    assert.equal(board.length, 3, 'app Catan + imported Catan + Recall');
    const app = board.find(b => b.id === appTable.id);
    assert.ok(app);
    assert.equal(app.importKey, null);
    assert.equal(app.importOrder, null);
    assert.deepEqual(app.participants, [{ slotNumber: 1, participantName: 'Owner', userId: 'owner' }]);
    const recall = board.find(b => b.gameTitle === 'Recall');
    assert.ok(recall);
    assert.equal(recall.importOrder, 1, 'was row 2, now row 1 of the sheet');
    assert.deepEqual(slotsOf(recall), { 1: 'Ela', 2: 'Ula', 3: 'Janek' });

    // The same sheet again changes nothing.
    const third = await syncSheet(db, [
      row('catan', 3, 0, null, [1, 'Ala']),
      row('Recall', 4, 0, null, [1, 'Ela'], [2, 'Ula']),
    ]);
    assert.equal(third.changed, false);

    // Azul was a catalog game, so it stays; an empty sheet removes every imported table and Recall's game.
    await syncSheet(db, []);
    assert.deepEqual((await db.selectFrom('play_tables').select('id').execute()).map(r => r.id), [appTable.id]);
    assert.deepEqual((await db.selectFrom('games').select('name').orderBy('name').execute()).map(g => g.name), ['Azul', 'Catan']);
  });

  test('saving a board edit keeps the imported flag of sheet seats', async t => {
    const db = await createDb(t);
    await addUserRow(db, 'janek');
    await syncSheet(db, [row('Recall', 4, 0, null, [1, 'Ela'])]);
    const id = (await loadBoard(db))[0]?.id;
    assert.ok(id !== undefined);

    assert.ok((await editTable(db, id, table => tryTakeSlot(table, 2, 'Janek', 'janek'))).ok);

    const seats = await db.selectFrom('table_slots').select(['slot_number', 'is_imported']).orderBy('slot_number').execute();
    assert.deepEqual(seats, [{ slot_number: 1, is_imported: 1 }, { slot_number: 2, is_imported: 0 }]);
    assert.equal((await loadBoard(db))[0]?.participants[0]?.isImported, true);
  });
});

describe('sheet import job', () => {
  type Deferred = { promise: Promise<Response>; resolve: (r: Response) => void };
  function deferred(): Deferred {
    let resolve: (r: Response) => void = () => {};
    const promise = new Promise<Response>(r => { resolve = r; });
    return { promise, resolve };
  }

  function fakeLog() {
    const entries: { level: string; args: unknown[] }[] = [];
    const at = (level: string) => (...args: unknown[]) => { entries.push({ level, args }); };
    return { entries, log: { info: at('info'), warn: at('warn'), error: at('error') } };
  }

  async function setup(t: TestContext, fetchFn: typeof fetch) {
    const db = await createDb(t);
    const notified: (number | null)[] = [];
    const { entries, log } = fakeLog();
    const deps: SheetImportDeps = {
      db, log, fetch: fetchFn,
      hub: { notify: change => { notified.push(change.tableId); } },
      settings: { enabled: true, sourceUrl: 'https://example.test/gviz', intervalMinutes: 30 },
    };
    return { db, notified, entries, deps };
  }

  async function seedSheetTable(db: Db) {
    await syncSheet(db, [row('Recall', 4, 0, null, [1, 'Ela'])]);
    return JSON.stringify(await loadBoard(db));
  }

  test('imports the feed and tells open pages', async t => {
    const { db, notified, deps } = await setup(t, () => Promise.resolve(new Response(feed)));
    const job = startSheetImport(deps);
    t.after(() => job.stop());
    await job.runNow();

    const board = await loadBoard(db);
    assert.deepEqual(board.map(b => b.gameTitle), ['Splendor marvel', 'Grimcoven', 'Bez max']);
    assert.ok(notified.length >= 1 && notified.every(id => id === null));
  });

  for (const [why, fetchFn] of [
    ['the download fails', () => Promise.reject(new Error('offline'))],
    ['the server answers an error', () => Promise.resolve(new Response('nope', { status: 500 }))],
    ['the tab is not the sign-up sheet', () => Promise.resolve(new Response('{"status":"ok","table":{"cols":[{"label":"Odpowiedzi"}],"rows":[]}}'))],
  ] as [string, typeof fetch][]) {
    test(`changes nothing when ${why}`, async t => {
      const { db, notified, entries, deps } = await setup(t, fetchFn);
      const before = await seedSheetTable(db);
      const job = startSheetImport(deps);
      t.after(() => job.stop());
      await job.runNow();

      assert.equal(JSON.stringify(await loadBoard(db)), before);
      assert.deepEqual(notified, []);
      assert.ok(entries.some(e => e.level === 'error'));
    });
  }

  test('never touches tables created in the app', async t => {
    const { db, deps } = await setup(t, () => Promise.resolve(new Response(feed)));
    await addUserRow(db, 'owner');
    const game = await db.insertInto('games').values({ name: 'Recall', kind: 'small', weight: '0', max_players: 4 })
      .returning('id').executeTakeFirstOrThrow();
    const app = await db.insertInto('play_tables').values({
      game_id: game.id, game_title: 'Splendor marvel', start_hour: '17:00', max_players: 4, kind: 'big', owner_user_id: 'owner', taken_slots: 1,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('table_slots').values({ play_table_id: app.id, slot_number: 1, participant_name: 'Owner', user_id: 'owner' }).execute();
    const before = JSON.stringify((await loadBoard(db)).find(b => b.id === app.id));

    const job = startSheetImport(deps);
    t.after(() => job.stop());
    await job.runNow();
    job.stop();
    const second = startSheetImport({ ...deps, fetch: () => Promise.resolve(new Response(feed.replace('Splendor marvel', 'Inna gra'))) });
    t.after(() => second.stop());
    await second.runNow();

    assert.equal(JSON.stringify((await loadBoard(db)).find(b => b.id === app.id)), before);
  });

  test('runs at start and on the timer, never two at once', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const pending: Deferred[] = [];
    const { deps } = await setup(t, () => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    });
    const job = startSheetImport(deps);
    t.after(() => job.stop());
    assert.equal(pending.length, 1, 'runs at start');

    const running = job.runNow();
    t.mock.timers.tick(30 * 60_000);
    t.mock.timers.tick(30 * 60_000);
    assert.equal(pending.length, 1, 'ticks during a run are skipped');

    pending[0]?.resolve(new Response(feed));
    await running;
    t.mock.timers.tick(30 * 60_000);
    assert.equal(pending.length, 2, 'the next tick runs again');
    pending[1]?.resolve(new Response(feed));
    await job.runNow();
  });

  test('is off when disabled', async t => {
    let calls = 0;
    const { entries, deps } = await setup(t, () => { calls++; return Promise.resolve(new Response(feed)); });
    const job = startSheetImport({ ...deps, settings: { ...deps.settings, enabled: false } });
    await job.runNow();
    job.stop();
    assert.equal(calls, 0);
    assert.ok(entries.some(e => e.level === 'info'));
  });
});
