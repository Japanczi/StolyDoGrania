# Live updates: WebSocket vs Blazor's SignalR connection

*Phase 3. Files: [`node-app/src/live/hub.ts`](../../node-app/src/live/hub.ts) (server),
[`node-app/public/js/board.js`](../../node-app/public/js/board.js) (browser, "live updates" at the bottom),
[`node-app/src/web/pages/board/routes.ts`](../../node-app/src/web/pages/board/routes.ts) (the `/fragments/…` routes).*

## What it is and why we need it

Normally the browser only talks when the user does something: it sends a request, the server answers. To show
*someone else's* change (Ala took a seat), the server needs a way to speak first. A **WebSocket** is a connection
the browser opens once and keeps open; either side can send a message at any time.

**What .NET did.** Blazor Server already kept a WebSocket per tab (SignalR, the "circuit"), but only to update
*that user's own page*: your click went up, your re-rendered table came down. Other people's pages weren't told,
so they saw changes only after a reload. That's why live updates are listed as **new** in the brief.

## Our design: "notify, then fetch"

```
Ala clicks "Wolne" ─▶ POST /api/tables/7/slots/2/take ─▶ rules + database ─▶ hub.notify({ tableId: 7 })
                                                                                  │
            every open page ◀── {"type":"board","version":42,"tableId":7,"boot":"…"} ◀┘
                 │
                 └─▶ GET /fragments/table/7  (with that page's own cookie)  ─▶ replaces the row
```

1. After **any** change, the server sends every open page a tiny message: *which table* changed (or `null` when
   tables were added or removed) and a **version number** that counts changes.
2. Each page fetches the changed row (`/fragments/table/7`) or all rows (`/fragments/board`) over normal HTTP.

Why not send the new HTML in the message? Because each viewer sees a *different* row: the owner gets ❌ and 🏷️,
an admin gets "choose owner", a logged-out visitor gets disabled seats. The fetched fragment is rendered by the same
`tableRow(viewer, table)` code as the page, with that viewer's rights. The message itself contains nothing
private (a test checks that no names appear in it), so it can safely go to everyone, logged in or not.

## Catching up after a disconnect

Wi-Fi drops, laptops sleep, the server restarts. The page keeps `version` and `boot`:

| Situation | How the page notices | What it does |
|---|---|---|
| Normal change | `version` is exactly one more | Fetch that one row |
| Missed messages | `version` jumped by more than one | Fetch all rows |
| Reconnected | the server says `hello` with its current version | Fetch all rows if it differs |
| Server restarted | `boot` (random per start) changed – the counter began again at 0 | Fetch all rows |

Reconnecting waits 1 s, 2 s, 4 s … up to 30 s between tries ("exponential backoff"), so a restarted server isn't
hit by every open page at once. After 3 s without a connection a small notice appears; it disappears on reconnect.
Blazor's equivalent was the `ReconnectModal.razor` dialog – there, losing the connection froze the whole page,
because every click needed the circuit. Here clicks are ordinary HTTP requests and keep working without the
WebSocket; only other people's changes wait.

## Side by side

Blazor (implicit): `@onclick="() => TakeSlotAsync(t.Id, n)"` – the click travels over SignalR, the component
re-renders, Blazor diffs the DOM and sends patches. You write no networking code.

Ours (explicit), server:

```ts
// src/live/hub.ts
notify(change) {
  version++;
  const message = JSON.stringify({ type: 'board', version, tableId: change.tableId, boot: bootId });
  for (const socket of sockets) if (socket.readyState === 1) socket.send(message);
}
```

browser:

```js
// public/js/board.js
const missedSome = msg.boot !== boot || msg.version > version + 1;
if (missedSome || msg.tableId == null) void refreshBoard(); else void refreshTable(msg.tableId);
```

## Security

- **Origin check.** Browsers send cookies with WebSocket connections and don't apply CORS to them, so another site
  could open a WebSocket to us with the visitor's cookie ("cross-site WebSocket hijacking"). `/live` closes any
  connection whose `Origin` isn't our own site (code 1008). Tested.
- **One-way.** Messages *from* the browser are ignored. Every change goes through the HTTP routes and their rights
  checks, so the WebSocket adds no new way to change anything.
- **Small.** `maxPayload: 1024` bytes; a ping every 30 s drops dead connections.

## What a popup does to refreshes

Replacing a row while its owner has the rename popup open would destroy the popup. So while any popup is open,
refreshes are postponed and run once it closes (`popupOpen` / `refreshPending` in board.js). An **armed two-click
delete** is handled more finely: refreshes go on, but morph skips that one button (`data-morph-skip`) – see the
pitfalls.

## Refreshes run one at a time (added 2026-11-23)

Every refresh is put in a queue (`queued()` in board.js: each one starts with `.then()` on the previous one's
promise). In .NET terms it's like awaiting each refresh before starting the next one, or a `SemaphoreSlim(1)`
around them. Without it, two refreshes run side by side, and an *older* answer can arrive *last* and undo a newer
one (a whole-board refresh rendered just before a delete put the deleted table back). In a queue, each refresh
fetches only after the previous one has been applied, so the page always ends at the newest state.

## Could this be used with .NET?

Yes – the idea is not Node-specific. ASP.NET Core has `app.UseWebSockets()` for raw WebSockets, and SignalR could
broadcast "table 7 changed" to all clients (`Clients.All.SendAsync(...)`), which is exactly what Blazor didn't do
for us automatically. The `ws`-based code itself is JavaScript.

## Pitfalls we hit

- Node's own `WebSocket` client sends no `Origin` header, so the server (correctly) refused it in tests; the test
  sets the header with undici's non-standard `headers` option.
- `app.injectWS()` (the plugin's test helper) never resolved here; the tests use a real listening server instead,
  which is closer to reality anyway.
- `@fastify/websocket`'s TypeScript types need the separate `@types/ws` package.
- **A flaky end-to-end test was a real bug (2026-11-23).** After a new test began creating tables at the same time,
  `board.spec.ts` failed about once in ten runs: a deleted table stayed on the other browser's page. Looping the suite
  until it failed and reading Playwright's page snapshot (`test-results/…/error-context.md`) showed the delete was
  never even sent. Three causes, all in `board.js`:
  1. The two-click ❌ was armed when a live update patched the row. Morph reset the button (its armed look, *and*
     the class that lifted it above its invisible backdrop), so the confirming click hit the backdrop and disarmed.
     First fix: an armed button held *all* refreshes, like a popup. The user found the flaw at once: take a seat and
     click ❌ right after, and the seat looked ignored for up to 4 s, because the refresh showing it was held back.
     Final fix: refreshes go on, and morph leaves out only the armed button – it carries `data-morph-skip`, which
     `morph.js` honours (the same idea as idiomorph's "don't morph this node" callback). The regression test clicks
     the seat and ❌ from inside the page with no gap: with Playwright's own two clicks the seat always showed first,
     so the test passed even against the flawed fix.
  2. `act()` kept its `busy` flag until the follow-up refresh had finished, so a click during that refresh was
     dropped silently. First fix: `busy` covered only the request. Still not enough for the user, who clicks fast:
     a click while the request itself was on its way (about a quarter of a second) was still dropped. Final fix:
     **actions queue up** (`act()` chains them like the refresh queue), so every click happens, in order. To keep a
     double click from sending "take this seat" twice, a keyed action (`actOnce()`: take, free, delete) is ignored
     while the same one is already waiting – until the page shows its result, because until then the button still
     offers the old action.
  3. Refreshes ran side by side and could finish out of order. Fix: the queue above.
  Lesson: a test that fails "sometimes" when more happens at once is usually showing a race a real user can hit.
  `--repeat-each` didn't help here (every repeat shares one database); plain repeated runs did.
- **An invisible backdrop swallowed clicks (2026-11-23).** The armed ❌ (ported from .NET's `ConfirmButton`) put a
  transparent full-page layer under itself, so "a click anywhere else disarms". That click did nothing else, so
  ❌ → seat lost the seat click. Now there is no layer: a `pointerdown` listener in the *capture* phase (it runs
  before any element's own handlers) disarms, and the click carries on to whatever was pressed. Testing pitfall:
  Playwright waits for anything covering an element to go away before clicking, and the backdrop went away by
  itself after 4 s – so the first version of the test passed against the bug. `click({ force: true })` clicks
  at once, like a person.

## Official docs

- MDN, WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- `@fastify/websocket`: https://github.com/fastify/fastify-websocket
- `ws` library: https://github.com/websockets/ws
- OWASP, WebSocket security: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- SignalR (for comparison): https://learn.microsoft.com/aspnet/core/signalr/introduction
