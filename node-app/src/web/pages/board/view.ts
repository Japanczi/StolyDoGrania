import { html, type SafeHtml } from '../../html.ts';

/** Temporary board page until phase 3 ports the list of tables. */
export function boardPlaceholder(): SafeHtml {
  return html`<h1>Zapisy na gry</h1>
<p class="text-body-secondary">Tu pojawi się lista stołów (w budowie: wersja Node aplikacji).</p>`;
}
