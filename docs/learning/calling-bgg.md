# Calling BGG: fetch, XML and throttling vs HttpClient

*Phase 3. Files: [`node-app/src/integrations/bgg/client.ts`](../../node-app/src/integrations/bgg/client.ts) (port of
`Data/Bgg/BggClient.cs`), [`node-app/src/web/pages/board/lookup.ts`](../../node-app/src/web/pages/board/lookup.ts)
(the catalog-then-BGG lookup), cover upload in `routes.ts` (`readCreateForm`).*

## What it is and why we need it

When someone types a game name, the app looks it up on BoardGameGeek (BGG) to get the player count, difficulty and
cover. BGG offers an **XML API**: `GET …/xmlapi2/search?query=azul&type=boardgame` and `…/thing?id=230802&stats=1`.
The app must send its token, ask at most once every 5 seconds, and download covers once (never hot-link them).

## Side by side

| Task | .NET (`BggClient.cs`) | Node (`client.ts`) |
|---|---|---|
| HTTP client | `IHttpClientFactory` → `HttpClient` | the built-in global `fetch` (same API as in browsers) |
| Token | `Authorization: Bearer …` header | same |
| Timeout | HttpClient's default (100 s) | `AbortSignal.timeout(15_000)` per request – `AbortSignal` is Node's `CancellationToken` |
| XML | `XDocument.Parse` + LINQ to XML (built in) | `fast-xml-parser` package (Node has no XML parser built in) |
| One request per 5 s | `SemaphoreSlim` + "next request at" time | a **promise queue** + "next request at" time |
| Errors | `BggUnavailableException` | `BggUnavailableError` |

## Why a queue, when Node has one thread

See [node-basics.md](node-basics.md): two lookups can both reach `await sleep(...)` and both decide it's their turn.
The client chains every call onto the previous one (`queueTail.then(...)`), so they really go one at a time – the
job the `SemaphoreSlim(1, 1)` did in C#. A failed call is caught off the chain so it can't block the next one.

## Stateless lookups

In Blazor the lookup lived in the circuit: fields like `candidates`, `selectedGame` and `lookupVersion` stayed on
the server between clicks. Over plain HTTP the server forgets after each request, so the **state moved into the
page** (`createLookup` in board.js) and each step is one request: `POST /api/lookup` (auto / BGG button /
"Żadna z tych") or `POST /api/lookup/pick`. Answers are JSON; the page shows them with `textContent`, so a game name
can never inject HTML. The `lookupVersion` trick stayed: a late answer to an outdated lookup is ignored.

## Trusting nothing from the browser

The page sends a game id and the seat count the user chose (prefilled with BGG's count, or drawn 1–6 for other
games; since 2026-11-22 the user may change it). The server re-reads the game from the database and checks the count
itself: a whole number from 1 to the limit (20) – a page can't create a 50-seat table by editing the request
(tested). The chosen count goes to the table only; the catalog game keeps BGG's count.

## One client per process: the throttle lives in the object

The 5-second queue is a field of the client object (`queueTail` in `createBggClient`). Two clients = two queues that
know nothing of each other, so BGG could get two requests at once. Since the sheet import also talks to BGG
(2026-11-22), `server.ts` creates **one** client and passes it to both the routes (`buildApp({ bgg })`) and the import
(`startSheetImport({ bgg })`). In ASP.NET Core this is what registering `BggClient` as a **singleton** in DI did for
us; without a DI container we do the same by hand, by creating it once at startup and passing it along.

Because the import `await`s each BGG call before queueing the next, a user's lookup slips in between – it waits for
at most one import request (~5 s), not for the whole import.

## Slow calls stay outside the transaction

The sheet import finds its games on BGG (`findSheetGamesOnBgg`, src/import/sheet-games.ts) **before** it opens the
sync transaction, and passes the result in. SQLite allows one writer at a time; a transaction that waited 5 s per BGG
request would make every other write in the app (taking a seat, creating a table) wait too. Same rule as in EF Core:
don't call an external service between `BeginTransaction` and `Commit`.

## Cover uploads: checked by content, limited while receiving

Blazor's `InputFile` handed the server a .NET stream; here the browser sends `multipart/form-data` and
`@fastify/multipart` reads it. Two checks the .NET version did differently:

- **Size while receiving:** the multipart limit (`fileSize: 2 MB`) stops reading a bigger file instead of loading it
  all first.
- **Type by content:** the browser's declared type (`image/png`) is just a label anyone can fake. `sniffImageType`
  reads the first bytes ("magic numbers": PNG starts with `89 50 4E 47`, JPEG with `FF D8 FF`, …). A text file
  labelled `image/png` is refused (tested).

## Could this be used with .NET?

`fetch` and `fast-xml-parser` are JavaScript. .NET has `HttpClient` and LINQ to XML built in – for XML, .NET is the
more comfortable of the two. Magic-number checks work the same way in C#.

## Pitfalls we hit

- `fast-xml-parser` accepts almost anything; the client validates the XML first so a broken BGG answer becomes
  `BggUnavailableError`, like C#'s `XmlException`.
- BGG's weight must stay text (`"2.0488"`): turning it into a JavaScript `number` and back could change the digits.
- Google's JSON feed of a sheet gives a hyperlinked cell's **text** ("Link"), not its URL. The URLs are only in the
  sheet's HTML view, wrapped in Google's redirect (`google.com/url?q=https://boardgamegeek.com/boardgame/123&…`).
  `parseSheetLinks` scrapes that page; since a page for people can change any time, a parse that finds nothing just
  means "no links" and the import searches BGG by name instead.

## Official docs

- MDN, `fetch`: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
- Node, `AbortSignal.timeout`: https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay
- fast-xml-parser: https://github.com/NaturalIntelligence/fast-xml-parser
- BGG XML API 2: https://boardgamegeek.com/wiki/page/BGG_XML_API2
- `@fastify/multipart`: https://github.com/fastify/fastify-multipart
