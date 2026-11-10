// "Zapisy na gry" – the board at "/" (alias "/stoly"). Port of Components/Pages/Tables.razor's actions.
//
// Pages and fragments are GETs; every change is a POST from public/js/board.js (fetch, JSON or multipart) that
// answers JSON { ok, message? | error? }. After a change the hub tells every open page, which then re-fetches the
// rows it shows. Every POST re-checks who may do it, inside the database query where it matters (CLAUDE.md).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../../config.ts';
import type { Db } from '../../../db/database.ts';
import {
  deleteManagedTable, editManagedTable, editTable, freeSlot, insertTable, listUsers, loadBoard, loadBoardTable,
  logJoinedTable, notOwnerError, type Viewer,
} from '../../../db/queries/board.ts';
import {
  catalogNames, findGameById, findGameByName, getCover, insertHandAddedGame, setUploadedCover, type CatalogGame,
} from '../../../db/queries/games.ts';
import { findUserById, isUniqueViolation } from '../../../db/queries/users.ts';
import { allowedCoverTypes, maxCoverBytes, sniffImageType, tooManySpotsError } from '../../../domain/game.ts';
import {
  isOwner, isSlotTaken, isValidHour, ownerSlot, tableKinds, tryAddPlayer, tryAssignOwner, tryChangeGame, tryCreate,
  trySetTakenSlots, tryTakeSlot, type Result, type TableKind,
} from '../../../domain/play-table.ts';
import { isAdminRole } from '../../../domain/roles.ts';
import { shortName } from '../../../domain/user-name.ts';
import type { BggClient, BggCover } from '../../../integrations/bgg/client.ts';
import type { LiveHub } from '../../../live/hub.ts';
import { html } from '../../html.ts';
import { sendPage } from '../../respond.ts';
import { lookupGame, pickBggGame } from './lookup.ts';
import { addPlayerPopup, boardPage, tableRow, tableRows } from './view.ts';

export type BoardDeps = { config: Config; db: Db; bgg: BggClient; hub: LiveHub };

type Json = { ok: true; message?: string; tableId?: number } | { ok: false; error: string };

/** Who is asking, from the session only (phase 4 adds the admin's "normal user mode"). */
export function viewerOf(request: FastifyRequest): Viewer {
  const user = request.user;
  return user
    ? { userId: user.id, name: shortName(user.userName), isAdmin: isAdminRole(user.role) }
    : { userId: null, name: null, isAdmin: false };
}

export function boardRoutes(app: FastifyInstance, deps: BoardDeps): void {
  const { db, bgg, hub } = deps;

  // ---------- pages and fragments ----------

  for (const path of ['/', '/stoly']) {
    app.get(path, async (request, reply) => {
      const viewer = viewerOf(request);
      const tables = await loadBoard(db);
      // Arrived from "Baza gier" right after creating a table there.
      const nowy = Number((request.query as Record<string, string | undefined>).nowy);
      const highlighted = Number.isInteger(nowy) ? tables.find(t => t.id === nowy) ?? null : null;
      return sendPage(request, reply, {
        title: 'Zapisy na gry',
        head: html`<link rel="stylesheet" href="/css/board.css" />`,
        scripts: html`<script src="/js/board.js"></script>`,
        body: boardPage({
          viewer,
          tables,
          catalogNames: viewer.userId !== null ? await catalogNames(db) : [],
          bggConfigured: bgg.isConfigured,
          version: hub.version,
          highlightId: highlighted?.id ?? null,
          statusMessage: highlighted ? `Utworzono stół: ${highlighted.gameTitle ?? highlighted.game.name}.` : null,
        }),
      });
    });
  }

  /** All rows, for live updates. The version tells the page which change it now reflects. */
  app.get('/fragments/board', async (request, reply) => {
    const version = hub.version;
    const tables = await loadBoard(db);
    return reply.header('X-Board-Version', String(version)).header('X-Board-Boot', hub.bootId).header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8').send(tableRows(viewerOf(request), tables).value);
  });

  /** One row, for live updates and after the viewer's own action. 404 = the table is gone. */
  app.get('/fragments/table/:id', async (request, reply) => {
    const table = await loadBoardTable(db, idParam(request));
    if (!table) {
      return reply.code(404).header('Cache-Control', 'no-store').send('');
    }
    return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(tableRow(viewerOf(request), table).value);
  });

  /** The right-click popup on a seat: who can be added. Only for the table's owner or an admin. */
  app.get('/fragments/add-player', async (request, reply) => {
    const viewer = viewerOf(request);
    const query = request.query as Record<string, string | undefined>;
    const table = await loadBoardTable(db, Number(query.table));
    const slot = Number(query.slot);
    const assigningOwner = slot === ownerSlot;
    const allowed = table !== null && viewer.userId !== null
      && (assigningOwner ? viewer.isAdmin && !isSlotTaken(table, slot) : (viewer.isAdmin || isOwner(table, viewer.userId)));
    if (!table || !allowed) {
      return reply.code(403).send('');
    }
    const users = await listUsers(db);
    const options = users
      .filter(u => assigningOwner
        // Anyone but the person already there; a player seated elsewhere gets moved over.
        ? table.participants.every(p => p.slotNumber !== ownerSlot || p.userId !== u.id)
        : !isOwner(table, u.id) && table.participants.every(p => p.userId !== u.id))
      .map(u => ({ id: u.id, name: shortName(u.userName) }));
    return reply.type('text/html; charset=utf-8').send(addPlayerPopup(assigningOwner, options).value);
  });

  /** Covers are stored in the database and served from here (never hot-linked from BGG). */
  app.get('/covers/:id', async (request, reply) => {
    const cover = await getCover(db, idParam(request));
    if (!cover || !allowedCoverTypes.includes(cover.type)) {
      return reply.code(404).send('');
    }
    return reply.type(cover.type).header('Cache-Control', 'public, max-age=3600').send(cover.bytes);
  });

  // ---------- game lookup ----------

  app.post('/api/lookup', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ ok: false, error: 'Zaloguj się, aby utworzyć stół.' });
    const body = jsonBody(request);
    const mode = body.mode === 'bgg' || body.mode === 'hand' ? body.mode : 'auto';
    return reply.send(await lookupGame({ db, bgg }, str(body.name), mode, kindOf(body.kind) ?? 'small'));
  });

  app.post('/api/lookup/pick', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ ok: false, error: 'Zaloguj się, aby utworzyć stół.' });
    const body = jsonBody(request);
    const bggId = Number(body.bggId);
    if (!Number.isInteger(bggId) || bggId <= 0) {
      return reply.code(400).send({ ok: false, error: 'Nieprawidłowa gra.' });
    }
    return reply.send(await pickBggGame({ db, bgg }, bggId, kindOf(body.kind) ?? 'small'));
  });

  // ---------- creating a table ----------

  app.post('/api/tables', async (request, reply) => {
    const viewer = viewerOf(request);
    if (viewer.userId === null || viewer.name === null) {
      return send(reply, { ok: false, error: 'Zaloguj się, aby utworzyć stół.' });
    }
    const form = await readCreateForm(request);
    if ('error' in form) {
      return send(reply, { ok: false, error: form.error });
    }

    const name = form.fields.name.trim();
    if (name === '') return send(reply, { ok: false, error: 'Podaj nazwę gry.' });
    if (name.length > 200) return send(reply, { ok: false, error: 'Nazwa może mieć maksymalnie 200 znaków.' });
    const kind = kindOf(form.fields.kind);
    if (!kind) return send(reply, { ok: false, error: 'Nieznany rodzaj stołu.' });
    const hour = form.fields.hour === '' ? null : form.fields.hour;
    if (hour !== null && !isValidHour(hour)) return send(reply, { ok: false, error: 'Nieprawidłowa godzina.' });
    const takenSlots = Number(form.fields.takenSlots || '0');
    if (!Number.isInteger(takenSlots)) return send(reply, { ok: false, error: 'Podaj liczbę zajętych miejsc.' });
    if (takenSlots < 0) return send(reply, { ok: false, error: 'Liczba zajętych miejsc nie może być ujemna.' });

    // The game: the one picked in the lookup, else the catalog game of this name, else a new hand-added one.
    const gameId = Number(form.fields.gameId);
    const known: CatalogGame | null = Number.isInteger(gameId) && gameId > 0
      ? await findGameById(db, gameId)
      : await findGameByName(db, name);
    // A BGG game brings its own seat count. Otherwise the count drawn in the browser (1–6 during early
    // development, as in .NET) – checked here, so it can't be forged above that.
    const drawn = Number(form.fields.maxPlayers);
    const maxPlayers = known && known.bggId !== null && known.maxPlayers > 0 ? known.maxPlayers : drawn;
    if (!(known && known.bggId !== null && known.maxPlayers > 0) && (!Number.isInteger(drawn) || drawn < 1 || drawn > 6)) {
      return send(reply, { ok: false, error: 'Nieprawidłowa liczba miejsc.' });
    }
    const tooMany = tooManySpotsError(maxPlayers);
    if (tooMany) return send(reply, { ok: false, error: tooMany });
    if (takenSlots >= maxPlayers) return send(reply, { ok: false, error: 'Przy stole musi zostać co najmniej jedno miejsce dla Ciebie.' });

    try {
      let finalGameId: number;
      if (known) {
        finalGameId = known.id;
        // Checked here too, not just by hiding the button: only games without BGG data and without a cover.
        if (form.cover && known.bggId === null && !known.hasCover) {
          await setUploadedCover(db, known.id, form.cover);
        }
      } else {
        finalGameId = await insertHandAddedGame(db, { name, kind, maxPlayers, cover: form.cover });
      }
      const created = tryCreate({
        gameId: finalGameId, gameTitle: name, kind, maxPlayers, takenSlots, startHour: hour,
        ownerUserId: viewer.userId, ownerName: viewer.name,
      });
      if (!created.ok) return send(reply, created);
      const id = await insertTable(db, created.table, { text: name, userId: viewer.userId });
      hub.notify({ tableId: null });
      return send(reply, { ok: true, message: `Utworzono stół: ${name}.`, tableId: id });
    } catch (err) {
      request.log.error({ err }, 'Creating a table failed');
      return send(reply, { ok: false, error: 'Nie udało się zapisać stołu w bazie danych.' });
    }
  });

  // ---------- seats ----------

  app.post('/api/tables/:id/slots/:slot/take', async (request, reply) => {
    const viewer = viewerOf(request);
    const tableId = idParam(request);
    const slot = slotParam(request);
    if (viewer.userId === null || viewer.name === null) {
      return send(reply, { ok: false, error: 'Zaloguj się, aby zająć miejsce.' });
    }
    const userId = viewer.userId;
    const name = viewer.name;
    return change(reply, tableId, 'Nie udało się zająć miejsca (być może ktoś był szybszy). Spróbuj ponownie.', () =>
      editTable(db, tableId, async (table, trx) => {
        const result = tryTakeSlot(table, slot, name, userId);
        if (result.ok) {
          // Saved together with the seat, so the log never records a join that didn't happen.
          await logJoinedTable(trx, table, slot, userId, name);
        }
        return result;
      }));
  });

  app.post('/api/tables/:id/slots/:slot/free', async (request, reply) => {
    const viewer = viewerOf(request);
    const tableId = idParam(request);
    if (viewer.userId === null) {
      return send(reply, { ok: false, error: 'Zaloguj się, aby zwolnić miejsce.' });
    }
    return change(reply, tableId, 'Nie udało się zwolnić miejsca. Spróbuj ponownie.', async () =>
      (await freeSlot(db, tableId, slotParam(request), viewer)) ? { ok: true } : { ok: false, error: 'Nie możesz zwolnić tego miejsca.' });
  });

  /** Owner/admin: seat a registered user or a typed name; admin on the first seat: assign a new owner. */
  app.post('/api/tables/:id/slots/:slot/add', async (request, reply) => {
    const viewer = viewerOf(request);
    const tableId = idParam(request);
    const slot = slotParam(request);
    const body = jsonBody(request);
    const playerUserId = typeof body.userId === 'string' && body.userId !== '' ? body.userId : null;

    // A registered user's seat shows their user name from the database, not whatever the page sent.
    let name = str(body.name);
    if (playerUserId !== null) {
      const player = await findUserById(db, playerUserId);
      if (!player) return send(reply, { ok: false, error: 'Nie znaleziono użytkownika.' });
      name = shortName(player.user_name);
    }
    if (name.trim() === '') return send(reply, { ok: false, error: 'Nazwa gracza musi mieć od 1 do 100 znaków.' });

    return change(reply, tableId, 'Nie udało się zapisać zmiany.', () =>
      editManagedTable(db, tableId, viewer, table => {
        if (slot !== ownerSlot) {
          return tryAddPlayer(table, slot, name, playerUserId);
        }
        if (!viewer.isAdmin || playerUserId === null) {
          return { ok: false, error: 'Tylko administrator może wskazać właściciela stołu.' };
        }
        return tryAssignOwner(table, playerUserId, name);
      }));
  });

  // ---------- owner's / admin's edits ----------

  app.post('/api/tables/:id/taken', async (request, reply) => {
    const tableId = idParam(request);
    const count = Number(str(jsonBody(request).count));
    return change(reply, tableId, 'Nie udało się zapisać liczby zajętych miejsc.', () =>
      editManagedTable(db, tableId, viewerOf(request), table =>
        Number.isInteger(count) ? trySetTakenSlots(table, count) : { ok: false, error: 'Podaj liczbę zajętych miejsc.' }));
  });

  app.post('/api/tables/:id/kind', async (request, reply) => {
    const tableId = idParam(request);
    const kind = kindOf(jsonBody(request).kind);
    return change(reply, tableId, 'Nie udało się zapisać rodzaju stołu.', () =>
      editManagedTable(db, tableId, viewerOf(request), table => {
        if (!kind) return { ok: false, error: 'Nieznany rodzaj stołu.' };
        table.kind = kind;
        return { ok: true };
      }));
  });

  app.post('/api/tables/:id/hour', async (request, reply) => {
    const tableId = idParam(request);
    const raw = str(jsonBody(request).hour);
    return change(reply, tableId, 'Nie udało się zapisać godziny.', () =>
      editManagedTable(db, tableId, viewerOf(request), table => {
        if (raw !== '' && !isValidHour(raw)) return { ok: false, error: 'Nieprawidłowa godzina.' };
        table.startHour = raw === '' ? null : raw;
        return { ok: true };
      }));
  });

  /**
   * Rename: the name is looked up like a new table's. A BGG game brings its own seat count; otherwise the table
   * keeps its count. Every player leaves; a seated owner keeps the first seat (tryChangeGame).
   */
  app.post('/api/tables/:id/rename', async (request, reply) => {
    const viewer = viewerOf(request);
    const tableId = idParam(request);
    const body = jsonBody(request);
    const name = str(body.name).trim();
    if (name === '') return send(reply, { ok: false, error: 'Podaj nazwę gry.' });
    const gameId = Number(body.gameId);
    const before = await loadBoardTable(db, tableId);
    const oldTitle = before ? before.gameTitle ?? before.game.name : '';

    return change(reply, tableId, 'Nie udało się zmienić gry stołu.', () =>
      editManagedTable(db, tableId, viewer, async (table, trx) => {
        let game = Number.isInteger(gameId) && gameId > 0 ? await findGameById(trx, gameId) : await findGameByName(trx, name);
        const maxPlayers = game && game.bggId !== null && game.maxPlayers > 0 ? game.maxPlayers : table.maxPlayers;
        const tooMany = tooManySpotsError(maxPlayers);
        if (tooMany) return { ok: false, error: tooMany };
        if (!game) {
          const id = await insertHandAddedGame(trx, { name, kind: table.kind, maxPlayers, cover: null });
          game = await findGameById(trx, id);
        }
        return game ? tryChangeGame(table, game.id, name, maxPlayers) : { ok: false, error: 'Nie udało się zmienić gry stołu.' };
      }), `Zmieniono grę stołu: ${oldTitle} → ${name}.`);
  });

  app.post('/api/tables/:id/delete', async (request, reply) => {
    const viewer = viewerOf(request);
    const tableId = idParam(request);
    const table = await loadBoardTable(db, tableId);
    // The permission check is part of the DELETE query; the game stays in the catalog.
    if (!table || !(await deleteManagedTable(db, tableId, viewer))) {
      return send(reply, { ok: false, error: 'Tylko właściciel stołu lub administrator może go usunąć.' });
    }
    hub.notify({ tableId: null });
    return send(reply, { ok: true, message: `Usunięto stół: ${table.gameTitle ?? table.game.name}.` });
  });

  // ---------- helpers ----------

  /** Runs a change, maps database errors to `failMessage`, and on success tells every open page. */
  async function change(reply: FastifyReply, tableId: number, failMessage: string, run: () => Promise<Result>, successMessage?: string) {
    let result: Result;
    try {
      result = await run();
    } catch (err) {
      if (!isUniqueViolation(err)) {
        reply.log.error({ err }, 'Board change failed');
      }
      return send(reply, { ok: false, error: failMessage });
    }
    if (!result.ok) {
      return send(reply, result.error === notOwnerError ? { ok: false, error: notOwnerError } : result);
    }
    hub.notify({ tableId });
    return send(reply, successMessage ? { ok: true, message: successMessage } : { ok: true });
  }
}

function send(reply: FastifyReply, body: Json): FastifyReply {
  return reply.header('Cache-Control', 'no-store').send(body);
}

function idParam(request: FastifyRequest): number {
  const value = Number((request.params as Record<string, string>).id);
  return Number.isInteger(value) ? value : -1;
}

function slotParam(request: FastifyRequest): number {
  const value = Number((request.params as Record<string, string>).slot);
  return Number.isInteger(value) ? value : -1;
}

function jsonBody(request: FastifyRequest): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function kindOf(value: unknown): TableKind | null {
  return tableKinds.find(k => k === value) ?? null;
}

type CreateForm = { fields: Record<'name' | 'gameId' | 'kind' | 'hour' | 'takenSlots' | 'maxPlayers', string>; cover: BggCover | null };

/**
 * Reads the new-table form (multipart: fields + an optional cover file). The cover's size is limited while it
 * is received (2 MB, see the multipart limits in app.ts) and its type is checked by its content, not by what the
 * browser claims – a Node app gets the raw upload, unlike Blazor's InputFile.
 */
async function readCreateForm(request: FastifyRequest): Promise<CreateForm | { error: string }> {
  const fields: CreateForm['fields'] = { name: '', gameId: '', kind: 'small', hour: '', takenSlots: '0', maxPlayers: '' };
  let cover: BggCover | null = null;
  if (!request.isMultipart()) {
    return { error: 'Nieprawidłowy formularz.' };
  }
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'cover') {
          await part.toBuffer();
          continue;
        }
        const bytes = await part.toBuffer();
        if (bytes.length === 0) continue;
        if (part.file.truncated || bytes.length > maxCoverBytes) {
          return { error: 'Okładka może mieć maksymalnie 2 MB.' };
        }
        const type = sniffImageType(bytes);
        if (!type) {
          return { error: 'Okładka musi być obrazem PNG, JPEG, WebP lub GIF.' };
        }
        cover = { bytes, contentType: type };
      } else if (part.fieldname in fields && typeof part.value === 'string') {
        fields[part.fieldname as keyof CreateForm['fields']] = part.value;
      }
    }
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return { error: 'Okładka może mieć maksymalnie 2 MB.' };
    }
    throw err;
  }
  return { fields, cover };
}
