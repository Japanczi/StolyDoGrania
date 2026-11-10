// @ts-check
// Admin users page: changing a role's <select> saves at once (as in the Blazor page). Without JavaScript the
// <noscript> "Zapisz" button does the same. The server re-checks every change.

for (const select of document.querySelectorAll('select[data-autosubmit]')) {
  select.addEventListener('change', () => /** @type {HTMLSelectElement} */ (select).form?.requestSubmit());
}
