// The admin dock in the board's bottom-left corner: "🛡️ Uprawnienia admina" (a reminder of what admins can do)
// and "🧰 Narzędzia admina". Ports of Components/Layout/AdminHelpBox.razor and AdminToolbox.razor.
// Rendered only for admins; every toolbox action is re-checked on the server (routes.ts, /api/admin/…).
// Opening/closing and the two-click buttons are handled by public/js/admin-dock.js.

import { html, type SafeHtml } from '../../html.ts';

export type AdminDockModel = { tableCount: number; autoReset: boolean; feedbackCount: number };

const autoResetHint = 'Włącz, aby lista stołów była czyszczona automatycznie w każdy poniedziałek o północy';

/** Polish plural: 1 stół, 2–4 stoły (except 12–14), otherwise stołów. */
export function tablesWord(n: number): string {
  return n === 1 ? 'stół' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'stoły' : 'stołów';
}

/** 1 uwagę, 2–4 uwagi (except 12–14), otherwise uwag. */
export function commentsWord(n: number): string {
  return n === 1 ? 'uwagę' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'uwagi' : 'uwag';
}

export function adminDock(m: AdminDockModel): SafeHtml {
  return html`<div class="admin-dock" id="admin-dock">
    ${helpBox()}
    <div class="admin-toolbox">
        <section class="toolbox-panel" id="toolbox-panel" aria-label="Narzędzia administratora" hidden>
            <div class="toolbox-item">
                <button type="button" class="confirm-button toolbox-button" id="toolbox-clear" data-count="${m.tableCount}"
                        ${m.tableCount === 0 ? html`disabled ` : ''}title="${m.tableCount === 0 ? 'Lista stołów jest pusta' : 'Usuń wszystkie stoły z listy'}"
                        data-armed-title="Kliknij ponownie, aby usunąć wszystkie stoły">Wyczyść listę stołów</button>
                <button type="button" role="switch" class="toolbox-switch" id="toolbox-auto" aria-checked="${m.autoReset ? 'true' : 'false'}"
                        title="${autoResetHint}" aria-label="Auto: ${autoResetHint}">
                    <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
                    <span class="switch-label">Auto</span>
                </button>
            </div>
            <div class="toolbox-item">
                <button type="button" class="confirm-button toolbox-button" id="toolbox-feedback" data-count="${m.feedbackCount}"
                        ${m.feedbackCount === 0 ? html`disabled ` : ''}title="${m.feedbackCount === 0 ? 'Brak uwag do pobrania' : 'Pobierz wszystkie uwagi użytkowników jako .zip i usuń je z serwera'}"
                        data-armed-title="Kliknij ponownie, aby pobrać uwagi i usunąć je z serwera">Pobierz i usuń uwagi (${m.feedbackCount})</button>
            </div>
            <div class="toolbox-item">
                <button type="button" class="toolbox-button" id="toolbox-disk" title="Pokaż zajętość dysku serwera">💾 Miejsce na dysku</button>
            </div>
            <div class="disk-usage" id="disk-usage" role="status" hidden></div>
        </section>
        <button type="button" class="btn btn-secondary btn-sm toolbox-toggle" id="toolbox-toggle" aria-expanded="false" aria-controls="toolbox-panel">🧰 Narzędzia admina</button>
    </div>
</div>`;
}

function helpBox(): SafeHtml {
  return html`<div>
    <section class="admin-help" id="admin-help" aria-label="Uprawnienia administratora" hidden>
        <div class="admin-help-head">
            <strong>Uprawnienia administratora</strong>
            <button type="button" class="btn-close" aria-label="Zwiń" data-help-close></button>
        </div>
        <p class="admin-help-intro">Na każdym stole:</p>
        <ul>
            <li><strong>Wiersz stołu:</strong> edycja ustawień</li>
            <li><strong>Lewy przycisk na graczu:</strong> usunięcie</li>
            <li><strong>Prawy przycisk na „Wolne” lub „Zajęte”:</strong> dodanie gracza</li>
            <li><strong>Prawy przycisk na 1. miejscu:</strong> nowy właściciel</li>
            <li><strong>❌ → ✓:</strong> usunięcie stołu (drugie kliknięcie)</li>
            <li><strong>🏷️:</strong> zmiana gry</li>
        </ul>
        <p class="admin-help-intro admin-help-section">🧰 Narzędzia admina:</p>
        <ul>
            <li><strong>Wyczyść listę stołów:</strong> usunięcie wszystkich stołów, drugim kliknięciem (gry zostają w katalogu)</li>
            <li><strong>Auto:</strong> automatyczne czyszczenie listy w każdy poniedziałek o północy</li>
            <li><strong>💾 Miejsce na dysku:</strong> zajętość dysku serwera, rozmiar bazy danych i uwag</li>
        </ul>
        <p class="admin-help-intro admin-help-section">Użytkownicy:</p>
        <ul>
            <li>Nadanie roli Admin, zmiana nazwy i usuwanie zwykłych kont</li>
            <li>Odebranie roli Admin, zmianę nazwy lub usunięcie konta admina może tylko główny administrator (Owner)</li>
            <li>Dołączenia do stołów, zmiany ról i nazw oraz usunięcia kont są zapisywane w dzienniku (Menu → Dziennik)</li>
        </ul>
        <p class="admin-help-intro admin-help-section">Baza gier:</p>
        <ul>
            <li><strong>❌ → ✓:</strong> usunięcie gry (drugie kliknięcie; tylko gdy nie ma przy niej stołów)</li>
        </ul>
        <a class="admin-help-link" href="/admin/users">Użytkownicy</a>
        <a class="admin-help-link" href="/admin/logs">Dziennik</a>
        <a class="admin-help-link" href="/gry">Baza gier</a>
    </section>
    <button type="button" class="btn btn-secondary btn-sm admin-help-toggle" id="admin-help-toggle">🛡️ Uprawnienia admina</button>
</div>`;
}
