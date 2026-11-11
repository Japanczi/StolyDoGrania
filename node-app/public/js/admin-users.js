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

// "Pokaż e-mail": addresses are hidden until an admin asks for one. The address comes as JSON from
// GET /admin/users/:id/email – not as HTML, because Cloudflare's e-mail obfuscation rewrites addresses in HTML
// responses into "[email protected]" and only decodes them on a full page load.
// The link has data-no-enhance, so enhance.js leaves it to us; without JavaScript it loads /admin/users?email=<id>.
// After the page is updated in place again (e.g. a rename), the server's HTML brings the button back: hidden by default.
document.addEventListener('click', async e => {
  const link = /** @type {Element} */ (e.target).closest('a[data-show-email]');
  if (!(link instanceof HTMLAnchorElement) || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (link.getAttribute('aria-busy') === 'true') return;
  link.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/admin/users/${encodeURIComponent(link.dataset.showEmail ?? '')}/email`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    const type = response.headers.get('content-type') ?? '';
    /** @type {{ ok?: boolean, email?: string, error?: string }} */
    const answer = type.includes('application/json') ? await response.json() : {};
    const text = document.createElement('span');
    if (answer.ok && answer.email) {
      // textContent, never innerHTML: the address is data, not markup.
      text.textContent = answer.email;
    } else {
      text.className = 'text-danger';
      text.textContent = answer.error ?? 'Nie udało się pobrać adresu e-mail.';
    }
    link.replaceWith(text);
  } catch {
    link.removeAttribute('aria-busy');
  }
});
