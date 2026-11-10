// @ts-check
// Page updates without a reload, for server-rendered pages that opt in with <main data-enhance> (users page,
// Baza gier, Dziennik). Links and forms inside it are sent with fetch(); the HTML the server answers is morphed into
// the page (morph.js), so only what changed is touched – no flash, scroll and focus stay. The address bar and the
// Back button keep working (history.pushState / popstate).
// Without JavaScript the links and forms work exactly as before (full page loads): this only enhances them.
// What a single-page-app framework or htmx's "boost" would do; here it's ~80 lines we can read.
// See docs/learning/no-flash.md.

(() => {
  const found = /** @type {HTMLElement | null} */ (document.querySelector('main[data-enhance]'));
  if (!found) return;
  // A separate constant, so the type checker knows it's never null inside the functions below.
  const main = found;
  let busy = false;

  /**
   * Fetches a page and morphs its <main> into ours. Anything unexpected (another layout, a download, an error page
   * from another area) falls back to a normal navigation, so nothing can get stuck half-updated.
   * @param {string} url @param {RequestInit} init @param {'push' | 'replace' | 'none'} history
   */
  async function load(url, init, history) {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { ...init.headers, 'x-requested-with': 'enhance' } });
      const type = response.headers.get('content-type') ?? '';
      const doc = type.includes('text/html') ? new DOMParser().parseFromString(await response.text(), 'text/html') : null;
      const fresh = doc?.querySelector('main[data-enhance]');
      if (!doc || !fresh || new URL(response.url).origin !== location.origin) {
        location.href = response.url || url;
        return;
      }
      window.morph.morphElement(main, fresh);
      document.title = doc.title;
      if (history === 'push') window.history.pushState(null, '', response.url);
      // After a POST only a redirect is a real address; a re-shown form (validation error) keeps the current one.
      if (history === 'replace' && (init.method !== 'POST' || response.redirected)) window.history.replaceState(null, '', response.url);
      // A field marked autofocus that just appeared (e.g. the rename input) gets the cursor.
      /** @type {HTMLElement | null} */ (main.querySelector('[autofocus]'))?.focus();
    } catch {
      location.href = url;
    } finally {
      busy = false;
    }
  }

  main.addEventListener('click', e => {
    const link = /** @type {HTMLAnchorElement | null} */ (/** @type {Element} */ (e.target).closest('a[href]'));
    if (!link || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (link.target || link.hasAttribute('download') || link.origin !== location.origin || link.dataset.noEnhance !== undefined) return;
    e.preventDefault();
    void load(link.href, {}, 'push');
  });

  main.addEventListener('submit', e => {
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (e.defaultPrevented || form.dataset.noEnhance !== undefined) return;
    e.preventDefault();
    // FormData includes the hidden _csrf field and the clicked submit button.
    const data = new FormData(form, /** @type {SubmitEvent} */ (e).submitter);
    const params = new URLSearchParams(/** @type {Record<string, string>} */ (/** @type {unknown} */ (data)));
    if (form.method.toLowerCase() === 'get') {
      const url = new URL(form.action);
      url.search = params.toString();
      // A search typed letter by letter replaces the history entry instead of adding one per letter.
      void load(url.href, {}, form.dataset.history === 'replace' ? 'replace' : 'push');
    } else {
      // The server answers with a redirect (Post/Redirect/Get); fetch follows it and we show where it led.
      void load(form.action, { method: 'POST', body: params, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 'replace');
    }
  });

  // Back / Forward: show that address's page, again without a reload.
  window.addEventListener('popstate', () => void load(location.href, {}, 'none'));
})();
