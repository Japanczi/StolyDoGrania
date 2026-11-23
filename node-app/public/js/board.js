// @ts-check
// The board's interactivity, in plain JavaScript (no framework). What Blazor's @onclick handlers and its
// circuit did for Tables.razor: clicks become fetch() POSTs to /api/…, answers are { ok, message?, error? },
// and the changed rows are re-fetched as HTML from the server (rendered there with this viewer's rights).
// The live connection (bottom of the file) does the same when someone else changes the board.
// See docs/learning/live-updates.md and docs/learning/server-rendered-html.md.

(() => {
  const board = document.getElementById('board');
  if (!board) return;

  const csrfToken = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="csrf-token"]'))?.content ?? '';
  const loggedIn = board.dataset.loggedIn === 'true';
  const bggConfigured = board.dataset.bgg === 'true';
  let version = Number(board.dataset.version);
  /** @type {string | null} */
  let boot = null;
  let busy = false;

  // ---------- requests ----------

  /**
   * POSTs JSON (or FormData) with the CSRF header. Network or server failures become { ok: false, error }.
   * @param {string} url
   * @param {object | FormData} [data]
   * @returns {Promise<any>}
   */
  async function post(url, data = {}) {
    const isForm = data instanceof FormData;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: isForm ? { 'x-csrf-token': csrfToken } : { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: isForm ? data : JSON.stringify(data),
        credentials: 'same-origin',
      });
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('application/json')) return await response.json();
      return { ok: false, error: response.status === 403 ? 'Sesja wygasła. Odśwież stronę i spróbuj ponownie.' : 'Wystąpił błąd. Spróbuj ponownie.' };
    } catch {
      return { ok: false, error: 'Brak połączenia z serwerem. Spróbuj ponownie.' };
    }
  }

  /**
   * Actions run one at a time, in the order they were clicked: a click made while an earlier request is still on its
   * way *waits its turn*. (It used to be dropped while "busy", so quick clicks seemed ignored for about a quarter of a
   * second – user report, 2026-11-23.) Then the action's message is shown and the page refreshed.
   * `key` (the request's URL) keeps the *same* action from being queued twice, e.g. a double click on one seat; it is
   * released once the page shows the result, because until then the button still offers the old action.
   */
  let actionQueue = Promise.resolve();
  /** @type {Set<string>} */
  const queuedKeys = new Set();

  /** @param {() => Promise<any>} action @param {number | null} tableId @param {string} [key] */
  function act(action, tableId, key) {
    if (key !== undefined) {
      if (queuedKeys.has(key)) return Promise.resolve(undefined);
      queuedKeys.add(key);
    }
    const sent = actionQueue.then(async () => {
      busy = true;
      try { return await action(); } finally { busy = false; }
    });
    actionQueue = sent.then(() => {}, () => {});
    return sent.then(async result => {
      if (result.ok) {
        if (result.message) showAlert(result.message, 'success');
      } else {
        showAlert(result.error ?? 'Wystąpił błąd.', 'warning');
      }
      if (tableId !== null && !result.created) await refreshTable(tableId); else await refreshBoard();
      return result;
    }).finally(() => { if (key !== undefined) queuedKeys.delete(key); });
  }

  /**
   * A button action that is one POST with no data (take/free a seat, delete): its URL is its key, so a double click
   * sends it once. (Changes with a value – hour, kind, count – aren't keyed: a second, different value must go too.)
   * @param {number | null} tableId @param {string} url
   */
  function actOnce(tableId, url) {
    return act(() => post(url), tableId, url);
  }

  // ---------- alerts ----------

  const alerts = /** @type {HTMLElement} */ (document.getElementById('board-alerts'));

  /** @param {string} message @param {'success' | 'warning'} kind */
  function showAlert(message, kind) {
    alerts.replaceChildren();
    const div = document.createElement('div');
    div.className = `alert alert-${kind} alert-dismissible py-2`;
    div.setAttribute('role', 'alert');
    div.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close py-2';
    close.setAttribute('aria-label', 'Zamknij');
    close.dataset.dismissAlert = '';
    div.append(close);
    alerts.append(div);
  }

  alerts.addEventListener('click', e => {
    if (/** @type {HTMLElement} */ (e.target).closest('[data-dismiss-alert]')) alerts.replaceChildren();
  });

  // ---------- refreshing rows ----------

  // The app's own tables, then (below the new-table row) the ones imported from the sheet – TEMPORARY (sheet import).
  const rowContainers = ['table-rows', 'imported-rows'].map(id => /** @type {HTMLElement} */ (document.getElementById(id)));
  const sheet = /** @type {HTMLDialogElement} */ (document.getElementById('table-sheet'));
  const sheetBody = /** @type {HTMLElement} */ (document.getElementById('sheet-body'));
  /**
   * A row's controls work the same in its copy in the phone sheet. (Not the new-table row when it's in the sheet:
   * it has its own listeners, see setUpDraft.) @param {Node} node
   */
  const inRows = node => rowContainers.some(c => c.contains(node)) || (sheetKey !== 'new' && sheetBody.contains(node));
  /**
   * While a popup is open the rows must not be patched (the rename popup lives inside its row): refreshes wait until
   * it closes. An armed two-click ❌ doesn't hold refreshes – that hid a seat just taken for up to 4 s (user report,
   * 2026-11-23); instead only the button itself is skipped by morph (data-morph-skip, see confirmClick).
   */
  let popupOpen = false;
  let refreshPending = false;
  const refreshesOnHold = () => popupOpen;

  /** Runs a refresh that waited, once nothing holds refreshes any more. */
  function releaseRefreshes() {
    if (refreshPending && !refreshesOnHold()) { refreshPending = false; void refreshBoard(); }
  }

  /**
   * Refreshes run one at a time, in the order they were asked for. Run side by side, an older answer could arrive
   * last and undo a newer one: a whole-board refresh rendered just *before* a delete, landing after the delete's own
   * refresh had removed the row, put the deleted table back (seen in the e2e tests, 2026-11-23). In a queue, each
   * refresh fetches only after the previous one has been applied, so the page ends up at the newest state.
   */
  let refreshQueue = Promise.resolve();
  /** @param {() => Promise<void>} task */
  function queued(task) {
    const run = refreshQueue.then(task, task);
    refreshQueue = run.catch(() => {});
    return run;
  }

  const refreshBoard = () => queued(refreshBoardNow);
  /** @param {number} id */
  const refreshTable = id => queued(() => refreshTableNow(id));

  async function refreshBoardNow() {
    if (refreshesOnHold()) { refreshPending = true; return; }
    const response = await fetch('/fragments/board', { credentials: 'same-origin' });
    if (!response.ok) return;
    version = Math.max(version, Number(response.headers.get('X-Board-Version')));
    boot = response.headers.get('X-Board-Boot') ?? boot;
    // Patched in place (morph.js), not replaced: unchanged rows, covers and inputs stay as they are – no flash.
    // Each container is patched separately, so the new-table row between them is left alone.
    const fresh = window.morph.parseFragment(await response.text());
    for (const container of rowContainers) {
      const source = fresh.querySelector(`#${container.id}`);
      if (source) window.morph.morphChildren(container, source);
    }
    syncSheet();
    if (!loggedIn) {
      const empty = rowContainers.every(c => c.children.length === 0);
      document.getElementById('board-empty')?.toggleAttribute('hidden', !empty);
      document.getElementById('table-list')?.toggleAttribute('hidden', empty);
    }
  }

  /** @param {number} id */
  async function refreshTableNow(id) {
    if (refreshesOnHold()) { refreshPending = true; return; }
    const response = await fetch(`/fragments/table/${id}`, { credentials: 'same-origin' });
    const row = document.getElementById(`table-${id}`);
    if (response.status === 404) { row?.remove(); syncSheet(); return; }
    if (!response.ok) return;
    const fresh = window.morph.parseFragment(await response.text()).firstElementChild;
    // A table this page doesn't have yet: fetch the whole board (directly – we're already in the queue).
    if (row && fresh) { window.morph.morphElement(row, fresh); syncSheet(); } else await refreshBoardNow();
  }

  // ---------- the phone sheet (one table's whole row, opened from its summary line) ----------
  // The sheet holds a *copy* of the row, kept in step with morph after every refresh: the row stays the single
  // source of truth, rendered on the server with this viewer's rights, and its buttons work through the same
  // listeners (see inRows). The copy gets its own id, so ids stay unique on the page.

  // The sheet also shows the new-table row ("+ Nowy stół"). That row isn't a copy: it is *moved* into the sheet and
  // back, because it holds what the user is typing and has its own listeners. Live updates never touch it.

  /** What the sheet shows: a table's id, 'new' for the new-table row, or null when closed. @type {number | 'new' | null} */
  let sheetKey = null;
  const draftRow = document.getElementById('draft');
  const draftPanel = document.getElementById('draft-panel');

  /** @param {number} id */
  function sheetCopyOf(id) {
    const row = document.getElementById(`table-${id}`);
    if (!row) return null;
    const copy = /** @type {HTMLElement} */ (row.cloneNode(true));
    copy.id = `sheet-table-${id}`;
    return copy;
  }

  /** @param {number} id */
  function openSheet(id) {
    const copy = sheetCopyOf(id);
    if (!copy) return;
    sheetBody.replaceChildren(copy);
    showSheet(id, 'Szczegóły stołu');
  }

  /** The new-table row (and its lookup messages) moved into the sheet, the name field focused. */
  function openDraftSheet() {
    if (!draftRow || !draftPanel) return;
    sheetBody.replaceChildren(draftRow, draftPanel);
    showSheet('new', 'Nowy stół');
    /** @type {HTMLInputElement | null} */ (draftRow.querySelector('#new-name'))?.focus();
  }

  /** @param {number | 'new'} key @param {string} label */
  function showSheet(key, label) {
    sheetKey = key;
    sheetBody.classList.toggle('sheet-draft', key === 'new');
    sheet.setAttribute('aria-label', label);
    setSheetMenu(false);
    sheet.showModal();
    // The phone's Back button should close the sheet, not leave the page: give it a history entry to go back from.
    // If the previous sheet's entry is still being removed (history.back() is asynchronous), add it once that's done.
    if (!backPending) history.pushState({ sheet: key }, '');
  }

  /** Set between our own history.back() and the popstate event it causes. */
  let backPending = false;

  /** After a refresh: patch the copy to match its row, or close the sheet if the table is gone. */
  function syncSheet() {
    if (typeof sheetKey !== 'number' || !sheet.open) return;
    const copy = sheetCopyOf(sheetKey);
    const current = sheetBody.firstElementChild;
    if (!copy) { sheet.close(); return; }
    if (current) window.morph.morphElement(current, copy); else sheetBody.replaceChildren(copy);
    setSheetMenu(sheetBody.classList.contains('menu-open'));
  }

  // ---------- the "⋯" menu in the sheet: the row's action buttons as a labelled list (phones) ----------
  // No menu of its own: the row's actions cell is shown or hidden (CSS, .menu-open), so the buttons are the very
  // same ones as on the desktop and work through the same listeners. The menu button shows only when the row
  // offers this viewer an action – rendered by the server with the viewer's rights, so it follows them.

  const sheetMenuButton = /** @type {HTMLButtonElement} */ (document.getElementById('sheet-menu'));

  // The menu floats over the sheet; a press anywhere outside it (and outside ⋯) closes it, like any dropdown.
  // The rename popup lives inside its menu item, so pressing in it doesn't count as outside.
  document.addEventListener('pointerdown', e => {
    if (!sheetBody.classList.contains('menu-open')) return;
    const target = /** @type {Element} */ (e.target);
    if (target.closest('.table-sheet .cell-actions') || target.closest('[data-sheet-menu]')) return;
    setSheetMenu(false);
  }, true);

  /** @param {boolean} open */
  function setSheetMenu(open) {
    const hasActions = typeof sheetKey === 'number' && sheetBody.querySelector('.cell-actions button:not([disabled])') !== null;
    sheetMenuButton.hidden = !hasActions;
    const show = open && hasActions;
    sheetBody.classList.toggle('menu-open', show);
    sheetMenuButton.setAttribute('aria-expanded', String(show));
  }

  // However it was closed (✕, a tap outside, Escape, Back), drop the history entry and the copy. The new-table row
  // goes back to its place in the list (half-filled, as the user left it) – between the two row containers.
  sheet.addEventListener('close', () => {
    closePopups();
    disarm();
    if (sheetKey === 'new' && draftRow && draftPanel) rowContainers[1].before(draftRow, draftPanel);
    sheetKey = null;
    sheetBody.replaceChildren();
    if (history.state?.sheet) { backPending = true; history.back(); }
  });

  document.getElementById('new-table-open')?.addEventListener('click', openDraftSheet);
  // "Anuluj" empties the form (setUpDraft); on a phone it also closes the sheet.
  document.getElementById('draft-cancel')?.addEventListener('click', () => { if (sheetKey === 'new') sheet.close(); });

  /** A table was created from the sheet: close it and show the new table's line. @param {number} id */
  function draftCreated(id) {
    if (sheetKey !== 'new') return;
    sheet.close();
    document.getElementById(`table-${id}`)?.scrollIntoView({ block: 'nearest' });
  }

  window.addEventListener('popstate', () => {
    if (backPending) {
      // Our own back() finished. A sheet opened meanwhile gets its history entry now.
      backPending = false;
      if (sheet.open && sheetKey !== null) history.pushState({ sheet: sheetKey }, '');
      return;
    }
    // The user pressed Back while the sheet was open: its entry is already gone, so just close it.
    if (sheet.open) sheet.close();
  });

  sheet.addEventListener('click', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    // A click on the dialog element itself (not its content) is a click on the backdrop around it.
    if (target === sheet || target.closest('[data-sheet-close]')) sheet.close();
    if (target.closest('[data-sheet-menu]')) setSheetMenu(!sheetBody.classList.contains('menu-open'));
  });

  /** Popups go inside the open sheet: showModal() makes everything outside it unclickable. */
  const popupHost = () => (sheet.open ? sheet : document.body);

  function popupClosed() {
    popupOpen = false;
    releaseRefreshes();
  }

  // ---------- row actions (event delegation: one listener for every row, even rows added later) ----------

  /** @param {Element} el */
  const tableIdOf = el => Number(/** @type {HTMLElement | null} */ (el.closest('[data-table-id]'))?.dataset.tableId);

  board.addEventListener('click', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const summary = target.closest('[data-sheet-open]');
    if (summary && inRows(summary)) { openSheet(tableIdOf(summary)); return; }
    const button = /** @type {HTMLElement | null} */ (target.closest('[data-action]'));
    if (!button || !inRows(button)) return;
    const id = tableIdOf(button);
    const slot = Number(button.dataset.slot);
    switch (button.dataset.action) {
      case 'take': void actOnce(id, `/api/tables/${id}/slots/${slot}/take`); break;
      case 'free': void actOnce(id, `/api/tables/${id}/slots/${slot}/free`); break;
      case 'delete': confirmClick(button, () => actOnce(null, `/api/tables/${id}/delete`)); break;
      case 'hour': openHourPicker(button, e, hour => act(() => post(`/api/tables/${id}/hour`, { hour: hour ?? '' }), id)); break;
      case 'rename': openRename(button, id); break;
    }
  });

  board.addEventListener('change', e => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!inRows(input)) return;
    const id = tableIdOf(input);
    // The value is read now, not when the queued action runs: a refresh in between may have reset the field to the
    // server's old value (found by the e2e tests, 2026-11-23).
    const value = input.value;
    if (input.dataset.action === 'taken') void act(() => post(`/api/tables/${id}/taken`, { count: value }), id);
    if (input.dataset.action === 'kind') void act(() => post(`/api/tables/${id}/kind`, { kind: value }), id);
  });

  // Right-click on a seat: the owner's "add player" / the admin's "choose owner" popup.
  board.addEventListener('contextmenu', e => {
    const seat = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-popup]'));
    if (!seat || !inRows(seat)) return;
    e.preventDefault();
    void openAddPlayer(tableIdOf(seat), Number(seat.dataset.slot), e.clientX, e.clientY);
  });

  // ---------- two-click delete (ConfirmButton.razor) ----------

  /** @type {{ button: HTMLElement, timer: number } | null} */
  let armed = null;

  /**
   * First click arms (solid green ✓), second confirms; Escape, a click elsewhere or 4 s disarm it.
   * A click elsewhere disarms *and still does what it was for* (e.g. takes a seat). It used to land on an invisible
   * backdrop that only disarmed, so a quick ❌ → seat lost the seat click (user report, 2026-11-23).
   */
  function confirmClick(/** @type {HTMLElement} */ button, /** @type {() => unknown} */ onConfirm) {
    if (armed?.button === button) { disarm(); onConfirm(); return; }
    disarm();
    button.classList.add('armed');
    button.dataset.original = button.innerHTML;
    button.dataset.originalLabel = button.getAttribute('aria-label') ?? '';
    button.innerHTML = '<span class="confirm-check" aria-hidden="true">✓</span>';
    button.title = button.dataset.armedTitle ?? '';
    button.setAttribute('aria-label', button.dataset.armedLabel ?? '');
    // Live updates still patch the row (a seat just taken shows up), but not this button: patching it would undo its
    // armed look while it's still armed.
    button.dataset.morphSkip = '';
    button.focus();
    armed = { button, timer: window.setTimeout(disarm, 4000) };
  }

  // A press anywhere but the armed button disarms it. "pointerdown" in the capture phase runs before the click
  // itself, and nothing is cancelled, so the click then reaches whatever was pressed as usual.
  document.addEventListener('pointerdown', e => {
    if (armed && !armed.button.contains(/** @type {Node} */ (e.target))) disarm();
  }, true);

  function disarm() {
    if (!armed) return;
    const { button, timer } = armed;
    armed = null;
    clearTimeout(timer);
    button.classList.remove('armed');
    button.innerHTML = button.dataset.original ?? '❌';
    button.title = 'Usuń stół';
    if (button.dataset.originalLabel) button.setAttribute('aria-label', button.dataset.originalLabel);
    delete button.dataset.morphSkip;
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Escape closes the innermost thing only: a popup or an armed button first, then the sheet's ⋯ menu, the sheet
    // the next time.
    if (armed || closeCurrentPopup) {
      e.preventDefault();
      disarm();
      closePopups();
      return;
    }
    if (sheetBody.classList.contains('menu-open')) { e.preventDefault(); setSheetMenu(false); }
  });

  // ---------- popups (hour picker, add player, rename) ----------

  /** @type {(() => void) | null} */
  let closeCurrentPopup = null;

  function closePopups() {
    if (closeCurrentPopup) { const close = closeCurrentPopup; closeCurrentPopup = null; close(); }
  }

  /**
   * Shows a popup with a backdrop; clicking the backdrop or Escape closes it.
   * @param {HTMLElement} popup @param {HTMLElement} parent @param {string} backdropClass @param {() => void} [onClose]
   */
  function showPopup(popup, parent, backdropClass, onClose) {
    closePopups();
    const backdrop = document.createElement('div');
    backdrop.className = backdropClass;
    backdrop.addEventListener('click', () => closePopups());
    backdrop.addEventListener('contextmenu', e => { e.preventDefault(); closePopups(); });
    parent.append(backdrop, popup);
    popupOpen = true;
    closeCurrentPopup = () => { backdrop.remove(); popup.remove(); onClose?.(); popupClosed(); };
  }

  const hours = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

  /**
   * Quarter-hour picker (HourPicker.razor): every option visible at once, nothing to scroll.
   * @param {HTMLElement} button @param {MouseEvent} e @param {(hour: string | null) => unknown} onPick
   */
  function openHourPicker(button, e, onPick) {
    const popup = document.createElement('div');
    popup.className = 'hour-popup';
    popup.setAttribute('role', 'dialog');
    popup.tabIndex = -1;
    popup.setAttribute('aria-label', button.getAttribute('aria-label') ?? '');
    popup.style.left = `max(0px, min(${e.clientX}px, calc(100vw - 410px)))`;
    popup.style.top = `max(0px, min(${e.clientY}px, calc(100vh - 360px)))`;
    const grid = document.createElement('div');
    grid.className = 'hour-grid';
    for (const hour of hours) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `hour-option${hour === button.dataset.value ? ' hour-option-selected' : ''}`;
      option.textContent = hour;
      option.addEventListener('click', () => { closePopups(); onPick(hour); });
      grid.append(option);
    }
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'btn btn-secondary btn-sm';
    none.textContent = 'Bez godziny';
    none.addEventListener('click', () => { closePopups(); onPick(null); });
    popup.append(grid, none);
    button.setAttribute('aria-expanded', 'true');
    showPopup(popup, popupHost(), 'hour-backdrop', () => button.setAttribute('aria-expanded', 'false'));
    popup.focus();
  }

  /** @param {number} tableId @param {number} slot @param {number} x @param {number} y */
  async function openAddPlayer(tableId, slot, x, y) {
    const response = await fetch(`/fragments/add-player?table=${tableId}&slot=${slot}`, { credentials: 'same-origin' });
    if (!response.ok) return;
    const popup = document.createElement('div');
    popup.className = 'add-player';
    popup.setAttribute('role', 'dialog');
    popup.style.left = `min(${x}px, calc(100vw - 270px))`;
    popup.style.top = `min(${y}px, calc(100vh - 330px))`;
    // Server-rendered with the html tag (escaped), like the rows.
    popup.innerHTML = await response.text();
    const add = (/** @type {object} */ data) => { closePopups(); void act(() => post(`/api/tables/${tableId}/slots/${slot}/add`, data), tableId); };
    popup.addEventListener('click', e => {
      const option = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.add-player-option'));
      if (option) add({ userId: option.dataset.userId });
    });
    popup.querySelector('form')?.addEventListener('submit', e => {
      e.preventDefault();
      const name = /** @type {HTMLInputElement} */ (popup.querySelector('input[name="name"]')).value;
      if (name.trim() !== '') add({ name });
    });
    showPopup(popup, popupHost(), 'popup-backdrop');
    /** @type {HTMLInputElement | null} */ (popup.querySelector('input[name="name"]'))?.focus();
  }

  // ---------- game lookup (shared by the new-table row and the rename popup) ----------

  /**
   * @typedef {{ id: number, name: string, label: string, kind: string, maxPlayers: number, bggId: number | null,
   *   bggUrl: string | null, difficultyLabel: string, difficultyStyle: string | null, coverUrl: string | null }} GameView
   * @typedef {{ kind: 'selected', game: GameView, note: string | null }
   *   | { kind: 'candidates', title: string, candidates: { name: string, year: number | null, bggId: number }[] }
   *   | { kind: 'none', note: string | null, game: GameView | null }} LookupResult
   */

  /**
   * Holds one lookup's state and draws it into `panel` (textContent only: nothing from the server becomes HTML).
   * @param {HTMLElement} panel @param {() => string} getName @param {() => string} getKind @param {() => void} onChange
   */
  function createLookup(panel, getName, getKind, onChange) {
    const state = {
      /** @type {GameView | null} */ game: null,
      /** @type {LookupResult & { kind: 'candidates' } | null} */ candidates: null,
      /** @type {string | null} */ note: null,
      /** @type {string | null} */ error: null,
      loading: false,
      run: 0,
    };

    function draw() {
      panel.replaceChildren();
      const add = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text) => {
        const el = document.createElement(tag);
        el.className = cls;
        el.textContent = text;
        panel.append(el);
        return el;
      };
      if (state.error) add('div', 'alert alert-danger py-2 mb-2', state.error).setAttribute('role', 'alert');
      if (state.loading) {
        const status = add('div', '', ' Wczytuję dane z BoardGameGeek...');
        status.setAttribute('role', 'status');
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm';
        status.prepend(spinner);
      }
      if (state.note) add('div', 'form-text mt-0', state.note).setAttribute('role', 'status');
      if (state.candidates) {
        add('div', 'form-text mt-0 mb-1', state.candidates.title);
        const list = add('div', 'candidate-list', '');
        for (const c of state.candidates.candidates) {
          const group = document.createElement('div');
          group.className = 'btn-group btn-group-sm';
          const pick = document.createElement('button');
          pick.type = 'button';
          pick.className = 'btn btn-outline-light candidate-name';
          pick.textContent = c.year !== null ? `${c.name} (${c.year})` : c.name;
          pick.addEventListener('click', () => void request('/api/lookup/pick', { bggId: c.bggId, kind: getKind() }));
          const link = document.createElement('a');
          link.className = 'btn btn-outline-light candidate-link';
          link.href = `https://boardgamegeek.com/boardgame/${c.bggId}`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = 'Zobacz na BoardGameGeek';
          link.textContent = '↗';
          group.append(pick, link);
          list.append(group);
        }
        const none = document.createElement('button');
        none.type = 'button';
        none.className = 'btn btn-outline-light btn-sm';
        none.textContent = 'Żadna z tych';
        none.addEventListener('click', () => {
          state.candidates = null;
          // A game picked earlier stays when the BGG button's list is dismissed.
          if (state.game) { draw(); onChange(); } else void request('/api/lookup', { name: getName(), mode: 'hand', kind: getKind() });
        });
        list.append(none);
      }
      panel.hidden = panel.childElementCount === 0;
    }

    /** @param {string} url @param {object} data */
    async function request(url, data) {
      const run = ++state.run;
      state.loading = true;
      state.error = null;
      state.note = null;
      draw();
      const result = /** @type {LookupResult & { ok?: false, error?: string }} */ (await post(url, data));
      // A reply to an outdated lookup (the name changed meanwhile; BGG can take seconds) is ignored.
      if (run !== state.run) return;
      state.loading = false;
      if (result.ok === false) {
        state.error = result.error ?? 'Wystąpił błąd.';
      } else if (result.kind === 'candidates') {
        state.candidates = result;
      } else {
        state.candidates = null;
        state.game = result.game;
        state.note = result.note;
      }
      draw();
      onChange();
    }

    return {
      state,
      draw,
      /** @param {'auto' | 'bgg'} mode */
      lookup(mode) {
        const name = getName().trim();
        if (mode === 'auto') { state.game = null; state.candidates = null; }
        if (name === '') { state.run++; state.loading = false; state.note = null; state.error = null; draw(); onChange(); return; }
        if (mode === 'bgg' && state.loading) return;
        void request('/api/lookup', { name, mode, kind: getKind() });
      },
      reset() { state.run++; state.game = null; state.candidates = null; state.note = null; state.error = null; state.loading = false; draw(); },
      /** Can the form be saved now? Otherwise sets the reason (texts from Tables.razor). */
      ready() {
        if (state.loading) { state.error = 'Poczekaj na wynik wyszukiwania na BoardGameGeek.'; draw(); return false; }
        if (state.candidates) { state.error = 'Wybierz grę z listy albo kliknij „Żadna z tych”.'; draw(); return false; }
        return true;
      },
      /** @param {string} message */
      fail(message) { state.error = message; draw(); },
    };
  }

  // ---------- the new-table row ----------

  const draft = document.getElementById('draft');
  if (draft) setUpDraft(draft);

  /** @param {HTMLElement} draftRow */
  function setUpDraft(draftRow) {
    const nameInput = /** @type {HTMLInputElement} */ (document.getElementById('new-name'));
    const takenInput = /** @type {HTMLInputElement} */ (document.getElementById('new-taken'));
    const kindCell = /** @type {HTMLElement} */ (document.getElementById('new-kind-cell'));
    const kindSelect = /** @type {HTMLSelectElement} */ (kindCell.querySelector('select'));
    const hourCell = /** @type {HTMLElement} */ (document.getElementById('new-hour-cell'));
    const hourButton = /** @type {HTMLElement} */ (hourCell.querySelector('button'));
    const maxInput = /** @type {HTMLInputElement} */ (document.getElementById('new-max'));
    const linkCell = /** @type {HTMLElement} */ (document.getElementById('new-link'));
    const difficultyCell = /** @type {HTMLElement} */ (document.getElementById('new-difficulty'));
    const coverPreview = /** @type {HTMLElement} */ (document.getElementById('new-cover-preview'));
    const coverLabel = /** @type {HTMLElement} */ (document.getElementById('new-cover-label'));
    const coverInput = /** @type {HTMLInputElement} */ (document.getElementById('new-cover'));
    const panel = /** @type {HTMLElement} */ (document.getElementById('draft-panel'));
    const createButton = /** @type {HTMLButtonElement} */ (document.getElementById('draft-create'));
    const bggButton = document.getElementById('draft-bgg');
    const cancelButton = /** @type {HTMLElement} */ (document.getElementById('draft-cancel'));

    /** Games not found on BGG still use a random count (1–6) during early development, as in .NET. */
    let drawnMaxPlayers = 1 + Math.floor(Math.random() * 6);
    /** @type {string | null} */ let hour = null;
    /** @type {string | null} */ let coverUrl = null;
    /**
     * The game whose defaults (kind, player count) were last copied into the row. Defaults are copied only when the
     * looked-up game changes, so the user's own choices aren't overwritten by every later update().
     * `undefined` = nothing copied yet (null is a real state: no game found).
     * @type {GameView | null | undefined}
     */
    let appliedGame;
    const lookup = createLookup(panel, () => nameInput.value, () => kindSelect.value, update);

    /** The game's own count: BGG's (or the catalog's) max players, else the drawn one. */
    function defaultMaxPlayers() {
      const g = lookup.state.game;
      return g && g.maxPlayers > 0 ? g.maxPlayers : drawnMaxPlayers;
    }

    /** Shows the row's other cells once the name is looked up (Tables.razor DraftDetailsVisible). */
    function update() {
      const g = lookup.state.game;
      const visible = !lookup.state.loading && !lookup.state.candidates && nameInput.value.trim() !== '';
      for (const cell of draftRow.querySelectorAll('[data-draft-detail]')) cell.toggleAttribute('hidden', !visible);
      bggButton?.toggleAttribute('hidden', nameInput.value.trim() === '');
      cancelButton.toggleAttribute('hidden', nameInput.value.trim() === '');
      if (!lookup.state.loading && g !== appliedGame) {
        appliedGame = g;
        if (g) kindSelect.value = g.kind;
        maxInput.value = String(defaultMaxPlayers());
      }
      kindCell.className = `cell kind-${kindSelect.value}`;
      hourCell.classList.toggle('hour-unset', hour === null);
      hourButton.textContent = hour ?? '--:--';
      hourButton.dataset.value = hour ?? '';
      takenInput.max = String(Math.max(0, Number(maxInput.value) - 1));
      maxInput.title = g?.bggId != null ? `Liczba graczy z BGG: ${g.maxPlayers}` : 'Liczba graczy';
      linkCell.replaceChildren();
      if (g?.bggUrl) {
        const a = document.createElement('a');
        a.href = g.bggUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Link';
        linkCell.append(a);
      } else {
        linkCell.textContent = '–';
      }
      difficultyCell.textContent = g ? g.difficultyLabel : '–';
      difficultyCell.setAttribute('style', g?.difficultyStyle ?? '');
      // Only for a game BGG doesn't have, and which has no cover yet.
      const canUpload = !g || (g.bggId === null && g.coverUrl === null);
      coverLabel.hidden = !canUpload;
      if (!canUpload) { coverInput.value = ''; setCoverPreview(null); }
      drawCover(g?.coverUrl ?? coverUrl);
    }

    /** @param {string | null} src */
    function drawCover(src) {
      coverPreview.replaceChildren();
      const name = nameInput.value.trim();
      if (src) {
        const img = document.createElement('img');
        img.className = 'thumb'; img.src = src; img.alt = `Okładka: ${name}`;
        coverPreview.append(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'thumb thumb-placeholder';
        let sum = 0;
        for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
        ph.style.backgroundColor = `hsl(${(sum * 47) % 360}, 55%, 35%)`;
        ph.setAttribute('aria-hidden', 'true');
        ph.textContent = name;
        coverPreview.append(ph);
      }
    }

    /** @param {string | null} url */
    function setCoverPreview(url) {
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      coverUrl = url;
    }

    function reset() {
      nameInput.value = '';
      takenInput.value = '0';
      kindSelect.value = 'small';
      hour = null;
      coverInput.value = '';
      setCoverPreview(null);
      drawnMaxPlayers = 1 + Math.floor(Math.random() * 6);
      appliedGame = undefined;
      lookup.reset();
      update();
    }

    // The name is looked up when the field loses focus ("change"), as with Blazor's @bind.
    nameInput.addEventListener('change', () => {
      coverInput.value = '';
      setCoverPreview(null);
      lookup.lookup('auto');
      update();
    });
    // Enter must not create a table: it only finishes the name (which triggers the lookup).
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
    bggButton?.addEventListener('click', () => lookup.lookup('bgg'));
    cancelButton.addEventListener('click', reset);
    kindSelect.addEventListener('change', update);
    maxInput.addEventListener('input', update);
    hourButton.addEventListener('click', e => openHourPicker(hourButton, e, picked => { hour = picked; update(); }));

    coverInput.addEventListener('change', () => {
      const file = coverInput.files?.[0];
      lookup.state.error = null;
      if (!file) { setCoverPreview(null); update(); return; }
      // Checked here for a quick answer; the server checks type (by content) and size again.
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        coverInput.value = ''; lookup.fail('Okładka musi być obrazem PNG, JPEG, WebP lub GIF.'); return;
      }
      if (file.size > 2 * 1024 * 1024) {
        coverInput.value = ''; lookup.fail('Okładka może mieć maksymalnie 2 MB.'); return;
      }
      setCoverPreview(URL.createObjectURL(file));
      update();
    });

    createButton.addEventListener('click', async () => {
      if (busy || !lookup.ready()) return;
      const name = nameInput.value.trim();
      if (name === '') { lookup.fail('Podaj nazwę gry.'); return; }
      const form = new FormData();
      form.set('name', name);
      form.set('gameId', String(lookup.state.game?.id ?? ''));
      form.set('kind', kindSelect.value);
      form.set('hour', hour ?? '');
      form.set('takenSlots', takenInput.value || '0');
      form.set('maxPlayers', maxInput.value);
      const file = coverInput.files?.[0];
      if (file) form.set('cover', file);
      createButton.disabled = true;
      try {
        const result = await act(async () => {
          const r = await post('/api/tables', form);
          if (!r.ok) { lookup.fail(r.error); return { ok: true }; }
          return r;
        }, null);
        if (result?.tableId) { reset(); draftCreated(result.tableId); }
      } finally {
        createButton.disabled = false;
      }
    });

    update();
  }

  // ---------- renaming a table (popup next to the 🏷️ button) ----------

  /** @param {HTMLElement} button @param {number} tableId */
  function openRename(button, tableId) {
    const row = /** @type {HTMLElement} */ (button.closest('[data-table-id]'));
    const anchor = /** @type {HTMLElement} */ (button.closest('.action-anchor'));
    const currentMax = Number(row.dataset.maxPlayers);

    const popup = document.createElement('div');
    popup.className = 'action-popup action-popup-wide';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Zmień grę');
    const label = document.createElement('label');
    label.htmlFor = 'rename-name';
    label.textContent = 'Nazwa gry';
    const input = document.createElement('input');
    input.id = 'rename-name';
    input.className = 'form-control form-control-sm';
    input.maxLength = 200;
    input.autocomplete = 'off';
    input.value = row.dataset.title ?? '';
    const panel = document.createElement('div');
    const seats = document.createElement('span');
    seats.className = 'form-text mt-0';
    const warning = document.createElement('span');
    warning.className = 'rename-warning';
    warning.textContent = 'Zapisanie zwolni wszystkie miejsca (zostaje tylko właściciel).';
    warning.hidden = row.dataset.hasPlayers !== 'true';
    const buttons = document.createElement('div');
    buttons.className = 'action-popup-buttons';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn btn-success btn-sm'; save.textContent = 'Zapisz';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-secondary btn-sm'; cancel.textContent = 'Anuluj';
    buttons.append(save);
    if (bggConfigured) {
      const bgg = document.createElement('button');
      bgg.type = 'button'; bgg.className = 'btn btn-outline-light btn-sm'; bgg.textContent = 'BGG';
      bgg.title = 'Szukaj tej gry na BoardGameGeek, np. innego wydania';
      bgg.addEventListener('click', () => lookup.lookup('bgg'));
      buttons.append(bgg);
    }
    buttons.append(cancel);
    popup.append(label, input, panel, seats, warning, buttons);

    const lookup = createLookup(panel, () => input.value, () => row.dataset.kind ?? 'small', () => {
      // A BGG game brings its own seat count; otherwise the table keeps its own.
      const g = lookup.state.game;
      const next = g && g.bggId !== null && g.maxPlayers > 0 ? g.maxPlayers : currentMax;
      const ready = !lookup.state.loading && !lookup.state.candidates && input.value.trim() !== '';
      seats.textContent = ready && next !== currentMax ? `Liczba miejsc: ${currentMax} → ${next}` : '';
    });

    input.addEventListener('change', () => lookup.lookup('auto'));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    cancel.addEventListener('click', () => closePopups());
    save.addEventListener('click', async () => {
      if (busy || !lookup.ready()) return;
      const name = input.value.trim();
      if (name === '') { lookup.fail('Podaj nazwę gry.'); return; }
      busy = true;
      const result = await post(`/api/tables/${tableId}/rename`, { name, gameId: lookup.state.game?.id ?? null });
      busy = false;
      // An error is shown in the popup, next to the name it's about.
      if (!result.ok) { lookup.fail(result.error); return; }
      closePopups();
      showAlert(result.message, 'success');
      await refreshTable(tableId);
    });

    /** @type {(() => void) | null} */
    let stopFollowing = null;
    showPopup(popup, anchor, 'popup-backdrop', () => stopFollowing?.());
    // In the phone sheet: a layer attached to the button (on the desktop the CSS already places it beside it).
    if (sheet.contains(anchor)) stopFollowing = followButton(popup, button);
    input.focus({ preventScroll: true });
    input.select();
  }

  /**
   * Keeps a popup attached to its button while it's open: placed now, again once the sheet's slide-in animation has
   * finished, and whenever the sheet scrolls or the screen changes size (e.g. the on-screen keyboard opens).
   * Returns the function that stops following. @param {HTMLElement} popup @param {HTMLElement} button
   */
  function followButton(popup, button) {
    const place = () => anchorToButton(popup, button);
    place();
    void Promise.all(sheet.getAnimations().map(a => a.finished)).then(place, () => {});
    sheet.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      sheet.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }

  /**
   * Places a fixed popup next to `button`, inside the screen: above it when the button is in the lower half (the
   * on-screen keyboard comes up from the bottom, and the popup then grows upwards, away from it), else below it.
   * Its height is limited to the room on that side; it scrolls inside if the lookup list needs more.
   * @param {HTMLElement} popup @param {HTMLElement} button
   */
  function anchorToButton(popup, button) {
    const gap = 4;
    const margin = 8;
    const r = button.getBoundingClientRect();
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - popup.offsetWidth - margin));
    popup.style.left = `${left}px`;
    if (r.top + r.height / 2 > window.innerHeight / 2) {
      popup.style.top = 'auto';
      popup.style.bottom = `${window.innerHeight - r.top + gap}px`;
      popup.style.maxHeight = `${r.top - gap - margin}px`;
    } else {
      popup.style.bottom = 'auto';
      popup.style.top = `${r.bottom + gap}px`;
      popup.style.maxHeight = `${window.innerHeight - r.bottom - gap - margin}px`;
    }
  }

  // ---------- "Tryb zwykłego użytkownika" (admins, and admins already in the mode) ----------

  const modeSwitch = /** @type {HTMLInputElement | null} */ (document.getElementById('normal-user-mode'));
  modeSwitch?.addEventListener('change', async () => {
    const result = await post('/api/admin/normal-user-mode', { active: modeSwitch.checked });
    if (!result.ok) { showAlert(result.error, 'warning'); modeSwitch.checked = !modeSwitch.checked; return; }
    // Roles apply per request: reload so the whole page (menu, rows, dock) shows the new view.
    location.reload();
  });

  // ---------- arrived from "Baza gier" with ?nowy= ----------

  const highlighted = board.dataset.highlight ? document.getElementById(`table-${board.dataset.highlight}`) : null;
  if (highlighted) {
    highlighted.focus();
    // Drop the parameter, so a refresh doesn't announce the table again.
    history.replaceState(null, '', '/');
  }

  // ---------- live updates ----------

  const liveStatus = /** @type {HTMLElement} */ (document.getElementById('live-status'));
  let retryDelay = 1000;
  /** @type {number | undefined} */ let statusTimer;

  function connect() {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);

    socket.addEventListener('open', () => {
      retryDelay = 1000;
      clearTimeout(statusTimer);
      liveStatus.hidden = true;
    });

    socket.addEventListener('message', e => {
      /** @type {{ type: string, version: number, tableId?: number | null, boot: string }} */
      const msg = JSON.parse(String(e.data));
      if (msg.type === 'hello') {
        // (Re)connected: anything missed in between, or a restarted server, means fetching everything.
        if (boot === null && msg.version === version) { boot = msg.boot; return; }
        boot = msg.boot;
        version = msg.version;
        void refreshBoard();
        return;
      }
      if (msg.type !== 'board') return;
      const missedSome = msg.boot !== boot || msg.version > version + 1;
      if (msg.version <= version && msg.boot === boot) return;
      boot = msg.boot;
      version = msg.version;
      if (missedSome || msg.tableId == null) void refreshBoard(); else void refreshTable(msg.tableId);
    });

    socket.addEventListener('close', () => {
      // Shown only if reconnecting takes a while, so a quick blip isn't noticed.
      clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => { liveStatus.hidden = false; }, 3000);
      // Growing delays (1 s, 2 s, 4 s … at most 30 s), so a server restart isn't flooded with reconnects.
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    });
  }

  connect();
})();
