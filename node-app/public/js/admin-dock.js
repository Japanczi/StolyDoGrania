// @ts-check
// The admin dock on the board (loaded for admins only): the permissions note and the toolbox.
// Port of AdminHelpBox.razor and AdminToolbox.razor. Every action is checked again on the server (/api/admin/…).

(() => {
  const dock = document.getElementById('admin-dock');
  if (!dock) return;
  const csrfToken = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="csrf-token"]'))?.content ?? '';
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  // ---------- open / close ----------

  const help = $('admin-help');
  const helpToggle = $('admin-help-toggle');
  helpToggle.addEventListener('click', () => { help.hidden = false; helpToggle.hidden = true; });
  dock.querySelector('[data-help-close]')?.addEventListener('click', () => { help.hidden = true; helpToggle.hidden = false; });

  const panel = $('toolbox-panel');
  const toggle = $('toolbox-toggle');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    // Closing the panel also disarms its buttons (as in Blazor, where they disappeared).
    if (panel.hidden) disarm();
  });

  // ---------- requests and messages ----------

  /** @param {string} url @param {object} [data] */
  async function post(url, data = {}) {
    try {
      const response = await fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(data),
      });
      return await response.json();
    } catch {
      return { ok: false, error: 'Brak połączenia z serwerem. Spróbuj ponownie.' };
    }
  }

  /** Same alerts as the board's actions (board.js renders into #board-alerts). */
  function showAlert(/** @type {string} */ message, /** @type {'success' | 'warning'} */ kind) {
    const alerts = $('board-alerts');
    const div = document.createElement('div');
    div.className = `alert alert-${kind} alert-dismissible py-2`;
    div.setAttribute('role', 'alert');
    div.textContent = message;
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'btn-close py-2'; close.setAttribute('aria-label', 'Zamknij');
    close.dataset.dismissAlert = '';
    div.append(close);
    alerts.replaceChildren(div);
  }

  const plural = (/** @type {number} */ n, /** @type {[string, string, string]} */ forms) =>
    n === 1 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? forms[1] : forms[2];

  const clearButton = /** @type {HTMLButtonElement} */ ($('toolbox-clear'));
  const autoSwitch = $('toolbox-auto');
  const feedbackButton = /** @type {HTMLButtonElement} */ ($('toolbox-feedback'));

  /** Re-reads counts and the Auto setting, so the toolbox always shows the saved state. */
  async function refresh() {
    const response = await fetch('/api/admin/toolbox', { credentials: 'same-origin' });
    if (!response.ok) return;
    const state = await response.json();
    clearButton.dataset.count = String(state.tables);
    clearButton.disabled = state.tables === 0;
    clearButton.title = state.tables === 0 ? 'Lista stołów jest pusta' : 'Usuń wszystkie stoły z listy';
    autoSwitch.setAttribute('aria-checked', String(state.autoReset));
    feedbackButton.dataset.count = String(state.feedback);
    feedbackButton.disabled = state.feedback === 0;
    feedbackButton.textContent = `Pobierz i usuń uwagi (${state.feedback})`;
    feedbackButton.title = state.feedback === 0 ? 'Brak uwag do pobrania' : 'Pobierz wszystkie uwagi użytkowników jako .zip i usuń je z serwera';
  }

  // ---------- two-click buttons (ConfirmButton.razor) ----------

  /** @type {{ button: HTMLButtonElement, text: string, title: string, timer: number } | null} */
  let armed = null;

  /** @param {HTMLButtonElement} button @param {string} armedText @param {() => unknown} onConfirm */
  function confirmClick(button, armedText, onConfirm) {
    if (armed?.button === button) { disarm(); onConfirm(); return; }
    disarm();
    armed = { button, text: button.textContent ?? '', title: button.title, timer: window.setTimeout(disarm, 4000) };
    button.classList.add('armed');
    button.textContent = armedText;
    button.title = button.dataset.armedTitle ?? '';
  }

  function disarm() {
    if (!armed) return;
    clearTimeout(armed.timer);
    armed.button.classList.remove('armed');
    armed.button.textContent = armed.text;
    armed.button.title = armed.title;
    armed = null;
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') disarm(); });
  document.addEventListener('click', e => {
    if (armed && !armed.button.contains(/** @type {Node} */ (e.target))) disarm();
  }, true);

  clearButton.addEventListener('click', () => {
    const n = Number(clearButton.dataset.count);
    confirmClick(clearButton, `✓ Kliknij ponownie – usunie ${n} ${plural(n, ['stół', 'stoły', 'stołów'])}`, async () => {
      const result = await post('/api/admin/clear-tables');
      showAlert(result.ok ? result.message : result.error, result.ok ? 'success' : 'warning');
      await refresh();
      // The board's rows are refreshed by the live update the server sends after clearing.
    });
  });

  // A switch button rather than a checkbox: its state always comes from the saved setting, even after a failed save.
  autoSwitch.addEventListener('click', async () => {
    const result = await post('/api/admin/auto-reset', { enabled: autoSwitch.getAttribute('aria-checked') !== 'true' });
    if (!result.ok) showAlert(result.error, 'warning');
    await refresh();
  });

  feedbackButton.addEventListener('click', () => {
    const n = Number(feedbackButton.dataset.count);
    confirmClick(feedbackButton, `✓ Kliknij ponownie – pobierze i usunie ${n} ${plural(n, ['uwagę', 'uwagi', 'uwag'])}`, downloadFeedback);
  });

  /** Downloads the zip, saves it through a temporary link, and only then asks the server to delete those comments. */
  async function downloadFeedback() {
    try {
      const response = await fetch('/api/admin/feedback/download', {
        method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('zip')) {
        const result = await response.json().catch(() => ({ error: 'Nie udało się pobrać uwag.' }));
        showAlert(result.error ?? 'Nie udało się pobrać uwag.', 'warning');
        return;
      }
      const files = JSON.parse(response.headers.get('X-Feedback-Files') ?? '[]');
      const name = /filename=([^;]+)/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'uwagi.zip';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
      const result = await post('/api/admin/feedback/delete', { files });
      showAlert(result.ok ? result.message : result.error, result.ok ? 'success' : 'warning');
    } catch {
      showAlert('Nie udało się pobrać uwag.', 'warning');
    } finally {
      await refresh();
    }
  }

  // ---------- disk usage (read-only; clicking again refreshes it) ----------

  const diskButton = $('toolbox-disk');
  const disk = $('disk-usage');
  const size = (/** @type {number} */ bytes) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
  };

  diskButton.addEventListener('click', async () => {
    const response = await fetch('/api/admin/disk-usage', { credentials: 'same-origin' });
    const result = await response.json();
    if (!result.ok) { showAlert(result.error, 'warning'); return; }
    const d = result.usage;
    diskButton.textContent = '💾 Miejsce na dysku (odśwież)';
    disk.replaceChildren();
    const bar = document.createElement('div');
    bar.className = 'disk-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.trunc(d.usedPercent)));
    bar.setAttribute('aria-label', 'Zajętość dysku');
    const fill = document.createElement('div');
    fill.className = `disk-bar-fill${d.usedPercent >= 90 ? ' critical' : d.usedPercent >= 75 ? ' warning' : ''}`;
    fill.style.width = `${Math.round(d.usedPercent * 10) / 10}%`;
    bar.append(fill);
    const line = (/** @type {string} */ cls, /** @type {(string | [string])[]} */ parts) => {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      // [text] = bold; plain strings stay plain. textContent only: nothing becomes HTML.
      for (const part of parts) {
        if (Array.isArray(part)) { const b = document.createElement('strong'); b.textContent = part[0]; div.append(b); }
        else div.append(part);
      }
      return div;
    };
    const readAt = new Date(d.readAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    disk.append(
      bar,
      line('', ['Zajęte ', [size(d.driveUsed)], ` z ${size(d.driveTotal)} (${Math.round(d.usedPercent)}%)`]),
      line('', ['Wolne: ', [size(d.driveFree)]]),
      line('disk-detail', [`Baza danych: ${size(d.database)} · Uwagi: ${size(d.feedback)}`]),
      line('disk-detail', [`Odczyt: ${readAt}`]),
    );
    disk.hidden = false;
  });
})();
