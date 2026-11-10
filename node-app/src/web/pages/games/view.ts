// "Baza gier" template. Port of the markup in Components/Pages/Games.razor.
// Sorting and search are plain links/forms (query parameters); only the two-click delete needs public/js/games.js.

import type { FastifyRequest } from 'fastify';
import type { CatalogRow } from '../../../db/queries/catalog-page.ts';
import { difficultyLabel, difficultyStyle, kindClass, kindLabel, maximumSpotsAllowed, placeholderHue } from '../../../domain/game.ts';
import { csrfField } from '../../forms.ts';
import { html, type SafeHtml } from '../../html.ts';

export type SortColumn = 'name' | 'kind' | 'players' | 'difficulty' | 'tables';
export const sortColumns: readonly SortColumn[] = ['name', 'kind', 'players', 'difficulty', 'tables'];

type State = { search: string; sort: SortColumn; descending: boolean };

export type GamesPageModel = State & {
  request: FastifyRequest;
  /** Number of games in the catalog; `visible` are those matching the search, already sorted. */
  total: number;
  visible: CatalogRow[];
  loggedIn: boolean;
  isAdmin: boolean;
  message: { kind: 'success' | 'danger'; text: string } | null;
};

// Polish plural: 1 gra, 2–4 gry (except 12–14), otherwise gier.
export function gamesWord(n: number): string {
  if (n === 1) return 'gra';
  return n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'gry' : 'gier';
}

/** The page's own URL with its state, e.g. /gry?q=azul&sort=players&dir=desc (defaults are left out). */
export function gamesUrl(state: State): string {
  const params = new URLSearchParams();
  if (state.search !== '') params.set('q', state.search);
  if (state.sort !== 'name') params.set('sort', state.sort);
  if (state.descending) params.set('dir', 'desc');
  const query = params.toString();
  return query === '' ? '/gry' : `/gry?${query}`;
}

export function gamesPage(m: GamesPageModel): SafeHtml {
  const state: State = { search: m.search, sort: m.sort, descending: m.descending };
  const countLabel = m.visible.length === m.total ? `${m.total} ${gamesWord(m.total)}` : `${m.visible.length} z ${m.total}`;
  return html`<div class="toolbar">
    <h1>Baza gier</h1>
    <span class="count">${countLabel}</span>
    <form class="search-form" method="get" action="/gry" role="search">
        ${m.sort !== 'name' && html`<input type="hidden" name="sort" value="${m.sort}" />`}
        ${m.descending && html`<input type="hidden" name="dir" value="desc" />`}
        <input type="search" name="q" value="${m.search}" class="form-control form-control-sm search" placeholder="Szukaj gry…" aria-label="Szukaj gry" data-search />
    </form>
</div>
${m.message && html`<div class="alert alert-${m.message.kind} alert-dismissible py-2" role="alert">${m.message.text}<button type="button" class="btn-close py-2" aria-label="Zamknij" data-dismiss-alert></button></div>`}
${m.total === 0
    ? html`<p class="text-secondary">Katalog gier jest pusty. Gry trafiają tu po utworzeniu stołu na stronie <a href="/">Zapisy na gry</a>.</p>`
    : html`<div class="game-list${m.isAdmin ? ' with-actions' : ''}" role="table" aria-label="Katalog gier">
    <div class="game-row game-head" role="row">
        ${m.isAdmin && html`<div class="cell cell-actions" role="columnheader"><span class="visually-hidden">Akcje</span></div>`}
        <div class="cell cell-cover" role="columnheader">Okładka</div>
        ${sortHeader('Nazwa', 'name', 'cell-name', state)}
        <div class="cell cell-create" role="columnheader">Nowy stół</div>
        ${sortHeader('Rodzaj stołu', 'kind', 'cell-kind', state)}
        ${sortHeader('Gracze', 'players', 'cell-num cell-players', state)}
        ${sortHeader('Trudność', 'difficulty', 'cell-num cell-difficulty', state)}
        ${sortHeader('Stoły', 'tables', 'cell-num cell-tables', state)}
        <div class="cell cell-bgg" role="columnheader">BGG</div>
    </div>
    ${m.visible.map(g => gameRow(m, g, state))}
    ${m.visible.length === 0 && html`<p class="text-secondary mt-2">Brak gier pasujących do „${m.search}”.</p>`}
</div>`}`;
}

function sortHeader(label: string, column: SortColumn, cssClass: string, state: State): SafeHtml {
  const active = state.sort === column;
  // Clicking the active column flips the direction; a new column starts A–Z / lowest first.
  const href = gamesUrl({ search: state.search, sort: column, descending: active && !state.descending });
  return html`<div class="cell ${cssClass}" role="columnheader" aria-sort="${active ? (state.descending ? 'descending' : 'ascending') : 'none'}">
        <a class="sort-btn${active ? ' active' : ''}" href="${href}" title="Sortuj: ${label}">${label} <span class="sort-arrow" aria-hidden="true">${active ? (state.descending ? '▼' : '▲') : ''}</span></a>
    </div>`;
}

/** Hidden fields that bring the viewer back to the same search and sorting after a POST. */
function stateFields(state: State): SafeHtml {
  return html`<input type="hidden" name="q" value="${state.search}" /><input type="hidden" name="sort" value="${state.sort}" /><input type="hidden" name="dir" value="${state.descending ? 'desc' : 'asc'}" />`;
}

function gameRow(m: GamesPageModel, g: CatalogRow, state: State): SafeHtml {
  const tooMany = g.maxPlayers > maximumSpotsAllowed;
  return html`<div class="game-row" role="row">
        ${m.isAdmin && html`<div class="cell cell-actions" role="cell">
            <!-- Two clicks (games.js): the first arms the button, the second submits. A game with tables cannot be removed. -->
            <form method="post" action="/gry/${g.id}/delete">
                ${csrfField(m.request)}${stateFields(state)}
                <button type="submit" class="confirm-button confirm-delete" data-confirm-delete
                        title="${g.tableCount > 0 ? 'Nie można usunąć gry, przy której są stoły' : 'Usuń grę z bazy'}"
                        aria-label="Usuń grę: ${g.name}"
                        data-armed-title="Kliknij ponownie, aby usunąć grę" data-armed-label="Kliknij ponownie, aby usunąć grę: ${g.name}"${g.tableCount > 0 ? html` disabled` : ''}>❌</button>
            </form>
        </div>`}
        <div class="cell cell-cover" role="cell">${cover(g)}</div>
        <div class="cell cell-name" role="cell">
            <span class="game-name">${g.name}</span>
            ${g.year !== null && html`<span class="game-year">(${g.year})</span>`}
        </div>
        <div class="cell cell-create" role="cell">
            ${!m.loggedIn
              ? html`<a class="btn btn-outline-light btn-sm" href="/Account/Login?ReturnUrl=%2Fgry" title="Zaloguj się, aby tworzyć stoły">Utwórz stół</a>`
              : tooMany
                ? html`<button type="button" class="btn btn-success btn-sm" disabled title="Gra ma więcej niż ${maximumSpotsAllowed} miejsc">Utwórz stół</button>`
                : html`<form method="post" action="/gry/${g.id}/create-table">${csrfField(m.request)}<button type="submit" class="btn btn-success btn-sm" title="Utwórz stół z tą grą i przejdź do niego">Utwórz stół</button></form>`}
        </div>
        <div class="cell cell-kind" role="cell"><span class="kind ${kindClass(g.kind)}">${kindLabel(g.kind)}</span></div>
        <div class="cell cell-num cell-players" role="cell">${g.maxPlayers}</div>
        <div class="cell cell-num cell-difficulty" role="cell"${difficultyStyle(g.weight) ? html` style="${difficultyStyle(g.weight)}"` : ''}>${difficultyLabel(g.weight)}</div>
        <div class="cell cell-num cell-tables" role="cell">${g.tableCount}</div>
        <div class="cell cell-bgg" role="cell">
            ${g.bggId !== null && g.bggUrl !== null
              ? html`<a href="${g.bggUrl}" target="_blank" rel="noopener noreferrer">Link</a>`
              : html`<span class="text-secondary" title="Gra dodana ręcznie – nie ma jej na BGG">–</span>`}
        </div>
    </div>`;
}

function cover(g: CatalogRow): SafeHtml {
  // Same rule as the board: a generated SVG placeholder counts as no cover (the real file is served by /covers/:id).
  return g.coverType !== null && g.coverType !== 'image/svg+xml'
    ? html`<img class="thumb" src="/covers/${g.id}" alt="Okładka: ${g.name}" loading="lazy" />`
    : html`<div class="thumb thumb-placeholder" style="background-color:hsl(${placeholderHue(g.name)}, 55%, 35%);" aria-hidden="true">${g.name}</div>`;
}
