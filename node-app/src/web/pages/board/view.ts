// Templates of the board ("Zapisy na gry"). Port of the markup in Components/Pages/Tables.razor.
//
// Rows are rendered on the server *for one viewer*: only the controls this viewer may use are included.
// That's also what makes live updates safe: other pages re-fetch these fragments with their own rights.
// The buttons carry data-* attributes; public/js/board.js turns clicks into requests (see routes.ts).

import type { BoardTable, Viewer } from '../../../db/queries/board.ts';
import {
  catalogLabel, defaultBggUrl, difficultyLabel, difficultyStyle, kindClass, kindLabel, placeholderHue,
} from '../../../domain/game.ts';
import { isOwner, isSlotTaken, maxTakenSlots, ownerSlot, tableKinds, type TableKind } from '../../../domain/play-table.ts';
import { html, type SafeHtml } from '../../html.ts';

const addPlayerHint = 'Prawy przycisk: dodaj gracza';
const assignOwnerHint = 'Prawy przycisk: wybierz właściciela';

export type BoardPageModel = {
  viewer: Viewer;
  tables: BoardTable[];
  catalogNames: string[];
  bggConfigured: boolean;
  /** Board version for live updates (see live/hub.ts). */
  version: number;
  /** Arrived from "Baza gier" after creating this table (?nowy=). */
  highlightId: number | null;
  statusMessage: string | null;
};

export function boardPage(m: BoardPageModel): SafeHtml {
  const loggedIn = m.viewer.userId !== null;
  return html`<div class="toolbar">
    <h1>Zapisy na gry</h1>
    ${!loggedIn && html`<a class="btn login-prompt" href="/Account/Register?ReturnUrl=stoly" title="Załóż konto, aby tworzyć stoły i zajmować miejsca">Dołącz do Planszówkarza teraz!</a>`}
</div>
<div class="board-alerts" id="board-alerts" aria-live="polite">${m.statusMessage && html`<div class="alert alert-success alert-dismissible py-2" role="alert">${m.statusMessage}<button type="button" class="btn-close py-2" aria-label="Zamknij" data-dismiss-alert></button></div>`}</div>
<div class="live-status" id="live-status" role="status" hidden>Łączenie… zmiany innych osób pojawią się po odświeżeniu połączenia.</div>
<div id="board" data-version="${m.version}" data-logged-in="${loggedIn ? 'true' : 'false'}" data-admin="${m.viewer.isAdmin ? 'true' : 'false'}"
     data-bgg="${m.bggConfigured ? 'true' : 'false'}"${m.highlightId !== null ? html` data-highlight="${m.highlightId}"` : ''}>
    <!-- Logged out with no tables: just a note (board.js swaps it for the list when a table appears). -->
    <div class="alert alert-info py-2" id="board-empty"${m.tables.length > 0 || loggedIn ? html` hidden` : ''}>Nie ma jeszcze żadnych stołów.</div>
    <div class="table-list" id="table-list"${m.tables.length === 0 && !loggedIn ? html` hidden` : ''}>
        <div class="table-row table-head">
            <div class="cell"></div>
            <div class="cell cell-game">Gra</div>
            <div class="cell">Zajęte</div>
            <div class="cell">Stół</div>
            <div class="cell">Godzina</div>
            <div class="cell">Graczy</div>
            <div class="cell">BGG</div>
            <div class="cell">Trudność</div>
            <div class="cell">Okładka</div>
            <div class="cell cell-slots">Miejsca</div>
        </div>
        <div class="table-rows" id="table-rows">${tableRows(m.viewer, m.tables, m.highlightId)}</div>
        ${loggedIn && draftRow(m.catalogNames, m.bggConfigured)}
        ${loggedIn && html`<div class="draft-panel" id="draft-panel" hidden></div>`}
    </div>
</div>`;
}

/**
 * All table rows. Re-fetched by live updates (GET /fragments/board) and swapped into #table-rows, so the new-table
 * row below them (which may be half filled in) is left alone.
 */
export function tableRows(viewer: Viewer, tables: BoardTable[], highlightId: number | null = null): SafeHtml {
  return html`${tables.map(t => tableRow(viewer, t, t.id === highlightId))}`;
}

/** One table's row (GET /fragments/table/:id). */
export function tableRow(viewer: Viewer, t: BoardTable, highlight = false): SafeHtml {
  const title = t.gameTitle ?? t.game.name;
  const owner = isOwner(t, viewer.userId);
  const canManage = owner || (viewer.isAdmin && viewer.userId !== null);
  const hasSeat = viewer.userId !== null && t.participants.some(p => p.userId === viewer.userId);

  return html`<div class="table-row${highlight ? ' table-new' : ''}" id="table-${t.id}" data-table-id="${t.id}" data-title="${title}"
         data-max-players="${t.maxPlayers}" data-kind="${t.kind}" data-has-players="${t.takenSlots > 0 || t.participants.some(p => !(p.slotNumber === ownerSlot && isOwner(t, p.userId))) ? 'true' : 'false'}"${highlight ? html` tabindex="-1"` : ''}>
    <div class="cell cell-actions">
        <div class="actions">
            ${canManage && html`<div class="action-anchor">
                <button type="button" class="confirm-button confirm-delete" data-action="delete"
                        title="Usuń stół" aria-label="Usuń stół: ${title}"
                        data-armed-title="Kliknij ponownie, aby usunąć stół" data-armed-label="Kliknij ponownie, aby usunąć stół: ${title}">❌</button>
            </div>
            <div class="action-anchor">
                <button type="button" class="action-button action-rename" data-action="rename" title="Zmień grę" aria-label="Zmień grę: ${title}">🏷️</button>
            </div>
            ${[1, 2, 3].map(() => html`<button type="button" class="action-button action-placeholder" disabled title="Opcja dostępna wkrótce" aria-label="Opcja dostępna wkrótce">🛠️</button>`)}`}
        </div>
    </div>

    <div class="cell cell-game"><span class="game-name">${title}</span></div>

    <div class="cell">
        ${canManage
          ? html`<input type="number" class="cell-input" data-action="taken" min="0" max="${maxTakenSlots(t)}" value="${t.takenSlots}" aria-label="Liczba miejsc oznaczonych jako zajęte: ${title}" />`
          : t.takenSlots > 0 && t.takenSlots}
    </div>

    <div class="cell ${kindClass(t.kind)}">
        ${canManage ? kindSelect(t.kind, `Rodzaj stołu: ${title}`, 'kind') : kindLabel(t.kind)}
    </div>

    <div class="cell${t.startHour === null ? ' hour-unset' : ''}"${t.startHour === null ? html` title="Godzina nie została ustalona"` : ''}>
        ${canManage
          ? hourButton(t.startHour, `Godzina spotkania: ${title}`)
          : (t.startHour ?? '—')}
    </div>

    <div class="cell">${t.maxPlayers}</div>

    <div class="cell"><a href="${t.game.bgg_url ?? defaultBggUrl}" target="_blank" rel="noopener noreferrer">Link</a></div>

    <div class="cell cell-difficulty"${difficultyStyle(t.game.weight) ? html` style="${difficultyStyle(t.game.weight)}"` : ''}>${difficultyLabel(t.game.weight)}</div>

    <div class="cell cell-cover">${cover(t.game.id, t.game.cover_type, title)}</div>

    <div class="cell cell-slots">${slots(viewer, t, owner, canManage, hasSeat)}</div>
</div>`;
}

function slots(viewer: Viewer, t: BoardTable, owner: boolean, canManage: boolean, hasSeat: boolean): SafeHtml[] {
  const loggedIn = viewer.userId !== null;
  const result: SafeHtml[] = [];
  for (let n = 1; n <= t.maxPlayers; n++) {
    const occupant = t.participants.find(p => p.slotNumber === n);
    const canAddPlayer = canManage && n !== ownerSlot && !occupant;
    const canAssignOwner = viewer.isAdmin && n === ownerSlot && !isSlotTaken(t, n);
    const canOpenPopup = canAddPlayer || canAssignOwner;
    const popup = canAssignOwner ? 'owner' : canAddPlayer ? 'add' : null;
    const popupHint = canAssignOwner ? assignOwnerHint : addPlayerHint;
    const popupAttr = popup ? html` data-popup="${popup}"` : '';

    if (isSlotTaken(t, n)) {
      result.push(html`<div class="slot slot-blocked" data-slot="${n}" title="${canAddPlayer ? addPlayerHint : 'Miejsce zajęte przez właściciela stołu'}"${popupAttr}>Zajęte</div>`);
    } else if (!occupant) {
      const canTake = loggedIn && !hasSeat && (!owner || n === ownerSlot);
      const hint = freeSlotHint(viewer, t, n, hasSeat, owner);
      // Stays enabled when it can't be taken but has a popup: browsers don't report right-clicks on disabled buttons.
      result.push(html`<button type="button" class="slot slot-free${canTake ? '' : ' slot-inert'}" data-slot="${n}"${canTake ? html` data-action="take"` : ''}${popupAttr}
                ${!canTake && !canOpenPopup ? html`disabled ` : ''}aria-disabled="${canTake ? 'false' : 'true'}"
                title="${canOpenPopup ? `${hint}. ${popupHint}` : hint}">Wolne</button>`);
    } else {
      const canFree = loggedIn && (occupant.userId === viewer.userId || canManage);
      const slotTitle = canFree ? `Zwolnij miejsce: ${occupant.participantName}` : occupant.participantName;
      result.push(html`<button type="button" class="slot ${isOwner(t, occupant.userId) ? 'slot-owner' : 'slot-taken'}" data-slot="${n}"${canFree ? html` data-action="free"` : ''}${canAssignOwner ? popupAttr : ''}
                ${!canFree ? html`disabled ` : ''}title="${canAssignOwner ? `${slotTitle}. ${assignOwnerHint}` : slotTitle}"><span class="slot-name">${occupant.participantName}</span></button>`);
    }
  }
  return result;
}

function freeSlotHint(viewer: Viewer, t: BoardTable, slot: number, hasSeat: boolean, owner: boolean): string {
  if (viewer.userId === null) return 'Zaloguj się, aby zająć miejsce';
  if (hasSeat) return 'Masz już miejsce przy tym stole';
  if (owner) return slot === ownerSlot ? 'Zajmij to miejsce' : 'Jako właściciel stołu możesz zająć tylko pierwsze miejsce';
  if (slot === ownerSlot && t.ownerUserId !== null) return 'Zajmij to miejsce – zostaniesz właścicielem stołu';
  return 'Zajmij to miejsce';
}

export function kindSelect(selected: TableKind, label: string, action: string | null): SafeHtml {
  return html`<select class="cell-input"${action ? html` data-action="${action}"` : ''} aria-label="${label}">
            ${tableKinds.map(k => html`<option value="${k}"${k === selected ? html` selected` : ''}>${kindLabel(k)}</option>`)}
        </select>`;
}

/** Opens the quarter-hour picker (built by board.js, like HourPicker.razor). */
function hourButton(value: string | null, label: string): SafeHtml {
  return html`<button type="button" class="hour-button" data-action="hour" data-value="${value ?? ''}" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false">${value ?? '--:--'}</button>`;
}

export function cover(gameId: number, coverType: string | null, title: string): SafeHtml {
  return coverType
    ? html`<img class="thumb" src="/covers/${gameId}" alt="Okładka: ${title}" loading="lazy" />`
    : placeholder(title);
}

function placeholder(title: string): SafeHtml {
  return html`<div class="thumb thumb-placeholder" style="background-color:hsl(${placeholderHue(title)}, 55%, 35%);" aria-hidden="true">${title}</div>`;
}

/**
 * The last row: a game-name field for a new table. The other cells are filled in by board.js once the game has
 * been looked up (catalog, then BGG). Not a <form>: Enter must not create a table (as in .NET).
 */
function draftRow(catalogNames: string[], bggConfigured: boolean): SafeHtml {
  return html`<div class="table-row table-draft" id="draft">
    <div class="cell"></div>
    <div class="cell cell-game">
        <input id="new-name" class="form-control form-control-sm" list="catalog-names" maxlength="200" autocomplete="off"
               placeholder="Nazwa gry" aria-label="Nazwa gry nowego stołu" />
        <datalist id="catalog-names">${catalogNames.map(n => html`<option value="${n}"></option>`)}</datalist>
        <div class="draft-actions">
            <button type="button" class="btn btn-success btn-sm" id="draft-create">Utwórz stół</button>
            ${bggConfigured && html`<button type="button" class="btn btn-outline-light btn-sm" id="draft-bgg" hidden title="Szukaj tej gry na BoardGameGeek, np. innego wydania">BGG</button>`}
            <button type="button" class="btn btn-outline-light btn-sm" id="draft-cancel" hidden>Anuluj</button>
        </div>
    </div>
    <div class="cell" data-draft-detail hidden><input id="new-taken" type="number" class="cell-input" min="0" value="0" aria-label="Liczba miejsc oznaczonych jako zajęte" /></div>
    <div class="cell kind-small" data-draft-detail id="new-kind-cell" hidden>${kindSelect('small', 'Rodzaj stołu', null)}</div>
    <div class="cell hour-unset" data-draft-detail id="new-hour-cell" hidden>${hourButton(null, 'Godzina spotkania')}</div>
    <div class="cell" data-draft-detail id="new-max" hidden></div>
    <div class="cell" data-draft-detail id="new-link" hidden></div>
    <div class="cell cell-difficulty" data-draft-detail id="new-difficulty" hidden></div>
    <div class="cell cell-cover" data-draft-detail hidden>
        <div class="draft-cover">
            <div id="new-cover-preview"></div>
            <label class="cover-upload" id="new-cover-label" title="Dodaj okładkę (PNG, JPEG, WebP lub GIF, maks. 2 MB)">
                <span aria-hidden="true">🗁</span>
                <input id="new-cover" type="file" class="visually-hidden" aria-label="Dodaj okładkę" accept="image/png,image/jpeg,image/webp,image/gif" />
            </label>
        </div>
    </div>
</div>`;
}

/** The owner's/admin's popup on a seat: registered users to choose from, plus a free-text name for regular seats. */
export function addPlayerPopup(assigningOwner: boolean, options: { id: string; name: string }[]): SafeHtml {
  const title = assigningOwner ? 'Wybierz właściciela stołu' : 'Dodaj gracza';
  return html`<strong class="add-player-title">${title}</strong>
<div class="add-player-list">
    ${options.map(o => html`<button type="button" class="add-player-option" data-user-id="${o.id}" data-name="${o.name}">${o.name}</button>`)}
    ${options.length === 0 && html`<span class="add-player-empty">Brak dostępnych graczy.</span>`}
</div>
${!assigningOwner && html`<form class="add-player-free">
    <input class="form-control form-control-sm" name="name" maxlength="100" placeholder="Inne imię i nazwisko" aria-label="Inne imię i nazwisko" />
    <button type="submit" class="btn btn-primary btn-sm">Dodaj</button>
</form>`}`;
}

/** Label of a catalog game in lookup messages ("Znaleziono na BoardGameGeek: …"). */
export { catalogLabel };
