# How a request flows: Fastify vs ASP.NET Core

*Phase 1. Files: [`node-app/src/server.ts`](../../node-app/src/server.ts), [`node-app/src/app.ts`](../../node-app/src/app.ts),
[`node-app/src/web/pages/board/routes.ts`](../../node-app/src/web/pages/board/routes.ts).*

## What it is and why we need it

A web server waits for HTTP requests ("GET /stoly"), decides which code handles each one, and sends back a
response (status code, headers, body). Node's built-in `node:http` module can do the waiting and sending, but
everything else – matching URLs to handlers, parsing cookies and forms, error pages, static files – is up to you.
**Fastify** is the framework that adds those parts, the way ASP.NET Core does for .NET.

## Startup: Program.cs split in two

`Program.cs` does two jobs: register services and build the middleware pipeline (top half), then run (`app.Run()`).
We split those into two files so tests can build the app without opening a port:

| Step | .NET (`Program.cs`) | Node |
|---|---|---|
| Read settings | `builder.Configuration` (appsettings, user-secrets, env) | `loadConfig()` in `src/config.ts` (see [config-and-secrets.md](config-and-secrets.md)) |
| Database | `AddDbContext<ApplicationDbContext>(…UseSqlite…)` | `openDatabase(path)` in `src/db/database.ts` – one connection, passed to whoever needs it |
| Build the pipeline | `app.UseStaticFiles()`, `UseExceptionHandler`, `MapRazorComponents` … | `buildApp()` in `src/app.ts`: hooks, `@fastify/static`, routes, error handlers |
| Run | `app.Run()` | `app.listen({ host, port })` in `src/server.ts` |
| Graceful stop | Host handles Ctrl+C / SIGTERM | We handle `SIGINT`/`SIGTERM` ourselves: `app.close()`, then close the database |

**No dependency-injection container.** ASP.NET Core creates services for you (`[Inject] ApplicationDbContext Db`).
Here, `server.ts` creates the database and passes it to `buildApp({ config, db })`, which passes it to the routes
that need it (`healthRoutes(app, db)`). More typing, but you can follow every object from where it's created to
where it's used – and tests pass in an in-memory database the same way.

## The life of one request

```
browser ── GET /stoly ──▶ Node's HTTP server ──▶ Fastify
                                                  │ 1. router: find the handler for GET /stoly
                                                  │ 2. hooks: onRequest → preParsing → preValidation → preHandler
                                                  │ 3. handler: boardRoutes' function → sendPage(...)
                                                  │ 4. onSend hook: add security headers
                                                  ▼
browser ◀── 200 text/html ──────────────────── response
```

ASP.NET Core instead runs a **middleware pipeline**: each `app.UseX()` wraps the next, and routing is one of the
middlewares. Fastify routes *first* and then runs **hooks** at fixed points of the request's life. The mapping:

| ASP.NET Core | Fastify | In our code |
|---|---|---|
| `app.Use(...)` middleware | `app.addHook('onRequest' / 'preHandler' / 'onSend', ...)` | `onSend` adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| `UseAuthentication` / `[Authorize]` | an `onRequest` hook that loads the session; a `preHandler` check per route | phase 2 |
| `app.MapGet("/x", ...)` / `@page "/x"` | `app.get('/x', handler)` | `boardRoutes` registers `/` and `/stoly` |
| `UseStaticFiles` / `MapStaticAssets` | `@fastify/static` | serves `node-app/public/` at the site root |
| `UseStatusCodePagesWithReExecute("/not-found")` | `app.setNotFoundHandler(...)` | Polish 404 page |
| `UseExceptionHandler("/Error")` + developer exception page | `app.setErrorHandler(...)` | Polish error page; stack only in development |
| `ILogger` | `request.log` / `app.log` (pino, JSON lines) | errors ≥ 500 are logged |

### Side by side: one page

Today `Components/Pages/Tables.razor` declares its routes at the top:

```razor
@page "/"
@page "/stoly"
<PageTitle>Zapisy na gry</PageTitle>
```

Node (`src/web/pages/board/routes.ts`):

```ts
export async function boardRoutes(app: FastifyInstance): Promise<void> {
  for (const path of ['/', '/stoly']) {
    app.get(path, async (request, reply) =>
      sendPage(request, reply, { title: 'Zapisy na gry', body: boardPlaceholder() }));
  }
}
```

A Razor page is a *component* that Blazor instantiates and renders; a Fastify route is just *a function that gets
the request and sends a reply*. `sendPage` (in `src/web/respond.ts`) wraps the body in the layout and sets the
content type – the job `MainLayout.razor` + `App.razor` do in Blazor.

### Plugins and `register`

`app.register(boardRoutes)` runs `boardRoutes` as a **plugin**: Fastify gives it its own "child" instance, so
hooks or decorations it adds stay inside it (encapsulation). That's how `@fastify/static` is added too. It's
the closest thing to `builder.Services.AddX()` + `app.UseX()` in one call. `healthRoutes(app, db)` is called
directly instead – a plain function is enough when nothing needs to be encapsulated.

## Differences from .NET worth remembering

- **One process, one thread** serves every request (see [node-basics.md](node-basics.md)); there's no per-request
  scope, so nothing is "scoped" per request unless we attach it to `request`.
- **No model binding.** Route parameters, query strings and forms arrive as strings; we validate them ourselves
  (phase 2 onward).
- **No HTTPS in the app.** Locally we use plain HTTP; on Mikrus, the platform's proxy terminates HTTPS, as for the
  .NET app (which had `UseHttpsRedirection`/`UseHsts` mostly for the template).
- **Errors in async handlers are caught by Fastify** and sent to `setErrorHandler` – thrown or rejected, both work.

## Could Fastify be used with .NET?

No – it's a JavaScript library running on Node. ASP.NET Core *is* the .NET equivalent; its Minimal APIs
(`app.MapGet`) look closest to Fastify routes.

## Pitfalls we hit

- `@fastify/static` registers a catch-all route for files. Our `/` route still wins because exact routes are
  matched before wildcards, and a missing file falls through to our 404 handler (both covered by tests).
- `index: false` on `@fastify/static`, otherwise it would try to serve `public/index.html` for `/`.

## Official docs

- Fastify lifecycle (the order of hooks): https://fastify.dev/docs/latest/Reference/Lifecycle/
- Hooks: https://fastify.dev/docs/latest/Reference/Hooks/
- Plugins and encapsulation: https://fastify.dev/docs/latest/Reference/Encapsulation/
- `inject()` for tests: https://fastify.dev/docs/latest/Guides/Testing/
- ASP.NET Core middleware (for comparison): https://learn.microsoft.com/aspnet/core/fundamentals/middleware/
