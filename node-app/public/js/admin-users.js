// @ts-check
// Admin users page: changing a role's <select> saves at once (as in the Blazor page). Without JavaScript the
// <noscript> "Zapisz" button does the same. The server re-checks every change.
// One listener on the document ("event delegation"), so selects that appear later (the page is updated in place
// by enhance.js) work too.

document.addEventListener('change', e => {
  const select = /** @type {Element} */ (e.target);
  if (select instanceof HTMLSelectElement && select.dataset.autosubmit !== undefined) {
    select.form?.requestSubmit();
  }
});
