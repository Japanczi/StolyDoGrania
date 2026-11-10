// "Baza gier" at /gry. Port of Components/Pages/Games.razor.
//
// The list is server-rendered; search and sorting are query parameters (/gry?q=…&sort=…&dir=…). Changes are plain
// HTML form POSTs (CSRF field, then Post/Redirect/Get with a one-time message in the flash cookie). Rights are
// re-checked here on every POST, not just by hiding buttons.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../../db/database.ts';
import { insertTable } from '../../../db/queries/board.ts';
import { deleteGameIfUnused, loadCatalog, type CatalogRow } from '../../../db/queries/catalog-page.ts';
import { findGameById } from '../../../db/queries/games.ts';
import { tooManySpotsError } from '../../../domain/game.ts';
import { tableKinds, tryCreate } from '../../../domain/play-table.ts';
import type { LiveHub } from '../../../live/hub.ts';
import { readForm, setFlash, takeFlash } from '../../forms.ts';
import { html } from '../../html.ts';
import { sendPage } from '../../respond.ts';
import { viewerOf } from '../board/routes.ts';
import { gamesPage, gamesUrl, sortColumns, type SortColumn } from './view.ts';

export type GamesDeps = { db: Db; hub: LiveHub };

// Pole-aware, case-insensitive ordering (CurrentCultureIgnoreCase in the .NET page).
const collator = new Intl.Collator('pl', { sensitivity: 'accent' });

export function gamesRoutes(app: FastifyInstance, deps: GamesDeps): void {
  const { db, hub } = deps;

  app.get('/gry', async (request, reply) => {
    const viewer = viewerOf(request);
    const state = readState((request.query ?? {}) as Record<string, unknown>);
    const flash = takeFlash(request, reply);

    let games: CatalogRow[] = [];
    let message = flash === null ? null : parseFlash(flash);
    try {
      games = await loadCatalog(db);
    } catch (err) {
      request.log.error({ err }, 'Loading the games catalog failed');
      message = { kind: 'danger', text: 'Nie udało się wczytać listy gier. Spróbuj odświeżyć stronę.' };
    }

    return sendPage(request, reply, {
      title: 'Baza gier',
      head: html`<link rel="stylesheet" href="/css/games.css" />`,
      scripts: html`<script src="/js/games.js"></script>`,
      body: gamesPage({
        request, ...state, total: games.length, visible: filterAndSort(games, state),
        loggedIn: viewer.userId !== null, isAdmin: viewer.isAdmin, message,
      }),
    });
  });

  /** Creates a table with the game's defaults (owner seated, no hour yet) and opens it on the board. */
  app.post('/gry/:id/create-table', async (request, reply) => {
    const viewer = viewerOf(request);
    const back = gamesUrl(readState(readForm(request.body)));
    if (viewer.userId === null || viewer.name === null) {
      return fail(reply, back, 'Zaloguj się, aby utworzyć stół.');
    }
    const game = await findGameById(db, idParam(request));
    if (!game) {
      return fail(reply, back, 'Tej gry nie ma już w bazie.');
    }
    // Games without a seat count (added by hand) get a count drawn from 1–6, like the board's new-table form.
    const maxPlayers = game.maxPlayers > 0 ? game.maxPlayers : 1 + Math.floor(Math.random() * 6);
    const tooMany = tooManySpotsError(maxPlayers);
    if (tooMany) {
      return fail(reply, back, tooMany);
    }
    const created = tryCreate({
      gameId: game.id, gameTitle: game.name, kind: tableKinds.includes(game.kind) ? game.kind : 'small', maxPlayers,
      takenSlots: 0, startHour: null, ownerUserId: viewer.userId, ownerName: viewer.name,
    });
    if (!created.ok) {
      return fail(reply, back, created.error);
    }
    try {
      // Saved together with the table; feeds the "Ostatnio" names under the board's game field.
      const id = await insertTable(db, created.table, { text: game.name, userId: viewer.userId });
      hub.notify({ tableId: null });
      // The board focuses and highlights the new table.
      return reply.redirect(`/?nowy=${id}`, 303);
    } catch (err) {
      request.log.error({ err }, 'Creating a table from the catalog failed');
      return fail(reply, back, 'Nie udało się zapisać stołu w bazie danych.');
    }
  });

  /** Admin only: deletes a game that no table uses; its alternate names go with it. */
  app.post('/gry/:id/delete', async (request, reply) => {
    const viewer = viewerOf(request);
    const back = gamesUrl(readState(readForm(request.body)));
    // Checked on the server too, not just by hiding the button.
    if (viewer.userId === null || !viewer.isAdmin) {
      return reply.code(403).type('text/plain; charset=utf-8').send('Tylko administrator może usuwać gry.');
    }
    try {
      const outcome = await deleteGameIfUnused(db, idParam(request));
      if (outcome.result === 'deleted') {
        setFlash(reply, `ok:Usunięto grę: ${outcome.name}.`);
      } else if (outcome.result === 'in-use') {
        setFlash(reply, `err:Nie można usunąć gry „${outcome.name}”, bo są przy niej stoły. Najpierw usuń te stoły.`);
      } else {
        setFlash(reply, 'err:Tej gry nie ma już w bazie.');
      }
    } catch (err) {
      request.log.error({ err }, 'Deleting a game failed');
      setFlash(reply, 'err:Nie udało się usunąć gry. Możliwe, że ktoś właśnie utworzył przy niej stół.');
    }
    return reply.redirect(back, 303);
  });
}

type State = { search: string; sort: SortColumn; descending: boolean };

/** Search and sorting from query parameters or posted fields; anything unknown falls back to the defaults. */
function readState(source: Record<string, unknown>): State {
  const q = typeof source.q === 'string' ? source.q.trim().slice(0, 200) : '';
  const sort = sortColumns.find(c => c === source.sort) ?? 'name';
  return { search: q, sort, descending: source.dir === 'desc' };
}

function filterAndSort(games: CatalogRow[], state: State): CatalogRow[] {
  const term = state.search.toLocaleLowerCase('pl');
  // Alternate names are not shown, but searching by them works.
  const filtered = term === '' ? games : games.filter(g =>
    g.name.toLocaleLowerCase('pl').includes(term) || g.alternateNames.some(a => a.toLocaleLowerCase('pl').includes(term)));
  const key = (g: CatalogRow): string | number => {
    switch (state.sort) {
      case 'kind': return tableKinds.indexOf(g.kind);
      case 'players': return g.maxPlayers;
      case 'difficulty': return Number(g.weight) || 0;
      case 'tables': return g.tableCount;
      default: return g.name;
    }
  };
  const direction = state.descending ? -1 : 1;
  return [...filtered].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const primary = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collator.compare(String(ka), String(kb));
    // Ties are always broken by name, A–Z.
    return primary * direction || collator.compare(a.name, b.name);
  });
}

function parseFlash(value: string): { kind: 'success' | 'danger'; text: string } | null {
  if (value.startsWith('ok:')) return { kind: 'success', text: value.slice(3) };
  if (value.startsWith('err:')) return { kind: 'danger', text: value.slice(4) };
  return null;
}

function fail(reply: FastifyReply, back: string, message: string): FastifyReply {
  setFlash(reply, `err:${message}`);
  return reply.redirect(back, 303);
}

function idParam(request: FastifyRequest): number {
  const value = Number((request.params as Record<string, string>).id);
  return Number.isInteger(value) ? value : -1;
}
