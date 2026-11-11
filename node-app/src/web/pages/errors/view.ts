// Error pages. Port of Components/Pages/NotFound.razor and Error.razor, translated to Polish
// (the .NET versions still had the template's English text).

import { html, type SafeHtml } from '../../html.ts';

export function notFoundPage(): SafeHtml {
  return html`<h1>Nie znaleziono strony</h1>
<p>Strona, której szukasz, nie istnieje. <a href="/">Wróć do zapisów na gry</a>.</p>`;
}

/**
 * Shown when a request fails unexpectedly. `details` (the error and stack) is only passed in Development,
 * like ASP.NET Core's developer exception page; production shows just the request id for the logs.
 */
export function errorPage(requestId: string, details: string | null): SafeHtml {
  return html`<h1 class="text-danger">Wystąpił błąd</h1>
<p class="text-danger">Nie udało się obsłużyć żądania. Spróbuj ponownie za chwilę.</p>
<p><strong>Identyfikator żądania:</strong> <code>${requestId}</code></p>
${details !== null && html`<h2 class="h5">Szczegóły (tylko w trybie deweloperskim)</h2>
<pre class="small">${details}</pre>`}`;
}
