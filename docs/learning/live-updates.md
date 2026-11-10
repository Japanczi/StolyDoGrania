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
refreshes are postponed and run once it closes (`popupOpen` / `refreshPending` in board.js).

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

## Official docs

- MDN, WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- `@fastify/websocket`: https://github.com/fastify/fastify-websocket
- `ws` library: https://github.com/websockets/ws
- OWASP, WebSocket security: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- SignalR (for comparison): https://learn.microsoft.com/aspnet/core/signalr/introduction
