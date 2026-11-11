# Updating pages without flashing: fetch + morphing vs Blazor's DOM diffing

*Added 2026-11-11 after "When pressing the button to change username, all elements flash". Files:
[`node-app/public/js/morph.js`](../../node-app/public/js/morph.js), [`enhance.js`](../../node-app/public/js/enhance.js),
used by [`board.js`](../../node-app/public/js/board.js); test: [`test/e2e/no-flash.spec.ts`](../../node-app/test/e2e/no-flash.spec.ts).*

## What happened, and why

Two different causes, one symptom:

1. **Admin pages reloaded.** "Zmień nazwę" was a plain link and "Zapisz" a plain form. Each click made the browser
   throw the whole page away, download a new one and paint it from scratch – the flash.
2. **The board replaced rows.** Changing a table's kind already used `fetch()`, but the updated row was put in with
   `row.outerHTML = html`. That creates brand-new elements, so the cover `<img>` is decoded again and briefly blank.
   (It even happened twice: once after our own action, once when the live-update notice arrived.)

**Why Blazor never flashed:** it kept the page open, rendered the component again *in memory*, compared the result with
the previous one ("diffing") and sent only the differences to the browser, which patched the existing elements.
Server-rendered HTML gives us the new HTML but not the diff – so we compute it in the browser.

## Morphing: the diff, in the browser

`morph.js` (~100 lines) walks the current element and the new HTML side by side:

| Situation | What it does |
|---|---|
| Same tag (and same `id`, if any) | keep the element; fix only changed attributes; recurse into children |
| Text differs | change the text node's value |
| An element with an `id` moved | find it by id and move it, instead of rebuilding it |
| New node | insert it |
| Node no longer there | remove it |
| An input the user is typing in | leave its value alone |

Because unchanged attributes aren't touched, an `<img>` with the same `src` is never reloaded – no flash. This is what
libraries like **idiomorph** (used by htmx and Turbo) or **morphdom** do; ours is small enough to read.

Side by side with the old board code:

```js
// before: new elements every time
row.outerHTML = html;
// after: the same elements, patched
window.morph.morphElement(row, window.morph.parseFragment(html).firstElementChild);
```

## enhance.js: links and forms without reloads

For server-rendered pages (users page, Baza gier, Dziennik), `<main data-enhance>` turns on a small script that
intercepts clicks on links and form submits inside it:

1. sends the same request with `fetch()` – a GET for links and search forms, a POST for forms (the hidden `_csrf`
   field travels along, and `fetch` sends the same-origin headers the CSRF check expects);
2. the server answers exactly as before (often a redirect after a POST – `fetch` follows it);
3. the new page's `<main>` is **morphed** into ours, the title updated, the address bar updated with
   `history.pushState` (so Back works; `popstate` loads the older address the same way).

Anything unexpected – an error page from another area, a redirect to the login page, another page entirely (e.g.
"Utwórz stół" leads to the board) – falls back to a normal navigation. Without JavaScript, the links and forms work
as before: the script only *enhances* them ("progressive enhancement").

This is a hand-written version of what htmx calls "boost" or Turbo calls "Drive".

## Proving it

A flash is hard to see in a test, but its cause is easy to detect. `no-flash.spec.ts` (Playwright):

- puts a marker on `window` before the action – a page reload throws `window` away, so the marker must survive;
- tags the table row and its cover element – they must be the *same* DOM nodes afterwards, not replacements.

## Could this be used with .NET?

The technique, yes: any server-rendered ASP.NET Core app (Razor Pages, MVC) can use morphing – often with htmx +
idiomorph. Blazor Server and Blazor's "enhanced navigation" (.NET 8+) already do it for you; that's the magic we gave up
and have now rebuilt in a small, visible form.

## Pitfalls

- Event listeners attached to one element are lost when that element is *replaced*; with morphing they mostly
  survive, but new elements still need them. Safest: one listener on `document` ("event delegation"), as
  `admin-users.js` now does.
- An input's *current* value lives in a property, not the `value` attribute – morph copies it explicitly, except for the
  field being typed in.
- After a POST that re-shows the form (a validation error), the address bar must not change to the POST's URL.
- **A proxy can rewrite the HTML you fetch.** In production the site sits behind Cloudflare, whose "Email Address
  Obfuscation" replaces every e-mail address in an HTML response with `[email protected]` and adds a script that
  decodes them – once, on page load. Full page loads looked fine; HTML fetched by `enhance.js` and morphed in stayed
  encoded. Our fix: the users page no longer puts addresses in its HTML at all. A "Pokaż e-mail" button asks
  `GET /admin/users/:id/email` and gets **JSON** (Cloudflare only rewrites `text/html`), and the script writes it with
  `textContent`. Other ways out: wrap the address in `<!--email_off-->…<!--email_on-->`, send
  `Cache-Control: no-transform`, or switch the feature off in the Cloudflare dashboard.
  The old Blazor page never hit this: its updates came over the SignalR WebSocket, which Cloudflare doesn't rewrite.
  - Docs: https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/

## Official docs

- MDN, `fetch`: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- MDN, History API: https://developer.mozilla.org/en-US/docs/Web/API/History_API
- idiomorph (the algorithm's inspiration): https://github.com/bigskysoftware/idiomorph
- Blazor enhanced navigation (for comparison): https://learn.microsoft.com/aspnet/core/blazor/fundamentals/routing#enhanced-navigation-and-form-handling
