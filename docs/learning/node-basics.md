# Node basics: one thread, the event loop, and async/await

*Phase 0. Code in this note is a sketch until phase 1 writes the real files.*

## What it is and why it matters

**Node.js** is a program that runs JavaScript outside the browser. It takes the JavaScript engine from Chrome (V8)
and adds what a server needs: files, network, timers, processes. When you run `node server.ts`, Node reads the
file and runs it – there is no separate "compile to a .dll" step as with `dotnet build` (see
[TypeScript vs C#](typescript-vs-csharp.md) for how `.ts` files run).

The single most important fact about Node: **your JavaScript runs on one thread.** ASP.NET Core serves requests
on many threads from a thread pool; if one request is slow, others run on other threads. Node instead has *one*
thread that runs all your code, for every user, and stays fast by never *waiting* on that thread. Whenever code
needs something slow (disk, network, a timer), Node starts it, moves on to other work, and comes back when
the result is ready. The mechanism that "comes back" is the **event loop**.

## The event loop in plain words

Picture a waiter in a restaurant (the one thread):

1. Take an order (an HTTP request arrives → run its handler).
2. The kitchen needs 10 minutes (a BGG request, a file write) → the waiter **doesn't stand in the kitchen**;
   they hand the order over and serve other tables.
3. When the kitchen rings the bell (the network answer arrived), the waiter picks the dish up as soon as they're
   free and continues that order.

In Node terms: the slow work is done by the operating system (network) or by a small pool of helper threads
inside Node (some file and crypto work). When it finishes, a **callback** is put in a queue. The event loop takes
callbacks off the queues one at a time and runs each **to completion** – nothing interrupts it halfway.

Two consequences:
- **No two pieces of your JS run at the same time.** You never need `lock` around a counter, as you sometimes do
  in C#.
- **Anything slow that runs *on* the thread freezes every user.** A 2-second loop in one request means every other
  request, every WebSocket message and every timer waits 2 seconds. This is called *blocking the event loop*.

## Promises and async/await vs C# Task

JavaScript's `Promise` is the counterpart of C#'s `Task`: an object representing a result that will exist later.
`async`/`await` work almost identically in both languages – C# took the idea first, JavaScript copied the syntax.

Today's BGG client (`Data/Bgg/BggClient.cs`):

```csharp
public async Task<BggGameDetails?> GetGameAsync(int bggId)
{
    var document = await GetXmlAsync(FormattableString.Invariant($"thing?id={bggId}&stats=1"));
    return ParseGameDetails(document);
}
```

The same in TypeScript (*sketch*):

```ts
async function getGame(bggId: number): Promise<BggGameDetails | null> {
  const document = await getXml(`thing?id=${bggId}&stats=1`);
  return parseGameDetails(document);
}
```

| C# / .NET | JavaScript / Node | Note |
|---|---|---|
| `Task<T>` | `Promise<T>` | Both start running immediately when the method is called ("hot") |
| `await` | `await` | Same meaning: "pause this function, let others run, resume with the result" |
| `Task.WhenAll(a, b)` | `Promise.all([a, b])` | |
| `Task.WhenAny` | `Promise.race` / `Promise.any` | |
| `await Task.Delay(1000)` | `await setTimeout(1000)` from `node:timers/promises` | |
| `CancellationToken` | `AbortSignal` (`AbortController` creates it) | `fetch(url, { signal: AbortSignal.timeout(10_000) })` |
| `PeriodicTimer` | `setInterval` from `node:timers/promises` (an async iterator) | See below |
| `ConfigureAwait(false)`, `SynchronizationContext` | Don't exist | There's only one thread, so there's no "context" to return to |
| Unobserved task exception: usually ignored | **Unhandled promise rejection crashes the process** (Node's default) | Always `await` or `.catch()` a promise |

### Side by side: the weekly reset loop

Today (`Data/Table/WeeklyBoardResetService.cs`):

```csharp
using var timer = new PeriodicTimer(CheckInterval);
do
{
    try { await ResetIfDueAsync(stoppingToken); }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        logger.LogError(ex, "The weekly reset of the list of tables failed; ...");
    }
}
while (await timer.WaitForNextTickAsync(stoppingToken));
```

Node (*sketch*):

```ts
import { setInterval } from 'node:timers/promises';

export async function runWeeklyReset(signal: AbortSignal) {
  await resetIfDueSafely();                         // once at startup, like the do-while
  for await (const _ of setInterval(60_000, undefined, { signal })) {
    await resetIfDueSafely();                       // then every minute
  }
}

async function resetIfDueSafely() {
  try { await resetIfDue(); }
  catch (err) { log.error({ err }, 'Weekly reset failed; retried at the next check.'); }
}
```

Very close. The differences: there is no `BackgroundService` base class or host that starts it – `server.ts`
simply calls `runWeeklyReset(signal)` without awaiting it, and aborts the signal on shutdown.

## "No threads" doesn't mean "no races"

Even with one thread, two requests can interleave **at every `await`**. The BGG client today guards its
"one request per 5 seconds" rule with a `SemaphoreSlim`, because two Blazor circuits could call it on two threads:

```csharp
private readonly SemaphoreSlim _requestGate = new(1, 1);
private DateTime _nextRequestAtUtc = DateTime.MinValue;
```

In Node you might think "one thread, so no gate needed". Wrong: request A reads `nextRequestAt`, then `await`s
a 5-second wait; while it waits, request B reads the *same* old `nextRequestAt` and also proceeds – both hit BGG
at once. The fix is a queue of promises – each call waits for the previous one (*sketch*):

```ts
let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    await waitUntilNextSlot();      // at most 1 request per 5 s
    return work();
  });
  queue = run.catch(() => {});      // a failed request must not block the queue
  return run;
}
```

The same holds for database writes: the board's `PlayTable` rules check "is this seat free?" and then write.
Between a check and a write that are separated by an `await`, another request can sneak in. With better-sqlite3
(synchronous, see below) a check-and-write inside one transaction has no `await` in the middle, so nothing can
interleave – one of the reasons it fits Node so well.

## What blocks the loop (and what we'll do about it)

| Blocks the thread | Why | What we do |
|---|---|---|
| better-sqlite3 queries | The driver is **synchronous** by design | Fine for small SQLite queries on a local disk (microseconds); keep queries indexed and small |
| `crypto.pbkdf2Sync`, `crypto.scryptSync` | Password hashing is deliberately slow (~50–100 ms) | Use the **async** versions (`crypto.scrypt`), which run on Node's helper threads |
| Big loops / huge JSON or XML parsing | Pure CPU work | BGG responses are small; fine |
| `fs.readFileSync` in a request handler | Waits for the disk | Use `fs/promises`; `*Sync` only at startup |

.NET comparison: blocking a thread-pool thread in ASP.NET Core hurts too ("sync over async", thread-pool
starvation), but much later – there are many threads. In Node, the very first blocking call hurts everyone.

## Could this be used with .NET?

The event loop is how Node (and browsers) work; .NET doesn't have one. But the *idea* exists in .NET:
`async`/`await` on a thread pool gives the same "don't wait on a thread" benefit with real parallelism on top.
Blazor Server is a nice in-between: each user's circuit processes its events **one at a time** (like a tiny
event loop per user) – that's why the board's `busy` flag in `Tables.razor` `WriteAsync` was enough there.

## Pitfalls

- Forgetting `await`: the function continues before the work finishes, and an error becomes an unhandled
  rejection that crashes the server. TypeScript can warn about "floating promises" only with a linter; for now we
  rely on review and tests.
- Calling a `*Sync` function in a request handler.
- `forEach` with an `async` callback doesn't wait – use `for … of` with `await` inside.

## Official docs

- The Node.js event loop: https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick
- Don't block the event loop: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
- Timers promises API: https://nodejs.org/api/timers.html#timers-promises-api
- MDN, using promises: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
