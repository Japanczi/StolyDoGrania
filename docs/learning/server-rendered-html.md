# Server-rendered HTML + plain JS vs Blazor Server

*Phase 1. Files: [`node-app/src/web/html.ts`](../../node-app/src/web/html.ts), [`layout.ts`](../../node-app/src/web/layout.ts),
[`public/js/layout.js`](../../node-app/public/js/layout.js), [`public/css/layout.css`](../../node-app/public/css/layout.css).*

## What it is and why we need it

There are two broad ways to make a web page:

1. **Server-rendered HTML** (ours): for each request the server builds a complete HTML document as a *string*
   and sends it. The browser shows it. Clicking a link or submitting a form sends a new request and gets a new page.
   Small pieces of browser JavaScript add behaviour HTML can't do alone.
2. **A live UI connection** (Blazor Server): the first page is HTML too, but then a WebSocket ("circuit") stays
   open; clicks travel to the server as events, the server re-renders the component *in memory*, computes the
   difference, and sends DOM patches back.

Blazor's model is why the .NET app needed no hand-written JavaScript for the board: an `@onclick="TakeSlotAsync"`
just worked. The price was hidden: a server-side object per open tab, a reconnect dialog (`ReconnectModal.razor`)
when the connection dropped, and two render modes to keep apart (Identity pages are static SSR, the board is
`InteractiveServer`). Our Node app uses only model 1 – which is exactly what the .NET app's Identity pages
already were (static SSR) – and adds WebSocket messages only for live updates (phase 3).

## The `html` tagged template – our whole template engine

A **tagged template** is a JavaScript feature: writing a function name before a backtick string,

```ts
html`<td class="slot">${slot.name}</td>`
```

calls `html(strings, ...values)` with the fixed parts (`['<td class="slot">', '</td>']`) and the values
(`[slot.name]`) **separately**. So `html` can escape *only the values* – the text a user could have typed – and
leave our own markup alone. That's the whole idea; `src/web/html.ts` is ~40 lines:

- `escapeHtml` turns `& < > " '` into entities, so a user named `<script>` shows up as text.
- Values that are already `SafeHtml` (the result of another `html` call) are inserted unchanged – that's how
  templates nest without escaping twice.
- Arrays are joined (lists of rows); `null`, `undefined` and `false` render nothing, so
  `${user?.isAdmin && html`…`}` works like Razor's `@if`.
- `raw()` skips escaping. Rule: only for fixed markup written in our code, never for anything that came from a user.

### Side by side: the profile button in the ribbon

Razor (`Components/Layout/MainLayout.razor`):

```razor
<AuthorizeView>
    <Authorized>
        <a class="btn btn-outline-light btn-sm app-user" href="Account/Manage" title="Profil">@UserNames.Short(context.User.Identity?.Name)</a>
    </Authorized>
</AuthorizeView>
```

Node (`src/web/layout.ts`):

```ts
${user && html`<a class="btn btn-outline-light btn-sm app-user" href="/Account/Manage" title="Profil">${user.shortName}</a>`}
```

| Razor | `html` tag |
|---|---|
| `@value` – escaped | `${value}` – escaped |
| `@((MarkupString)x)` – not escaped | `${raw(x)}` – not escaped (avoid) |
| `@if (cond) { <b>…</b> }` | `${cond && html`<b>…</b>`}` |
| `@foreach (var t in tables) { <Row T="t" /> }` | `${tables.map(t => row(t))}` |
| A component `<NavLink …/>` | A function `navLink(href, icon, label, currentPath)` |
| `<AuthorizeView>` | A plain `if` on the user passed in (phase 2 fills it from the session) |
| Compiled, type-checked | Type-checked (it's TypeScript), nothing compiled |

### What stays the same: CSS-only drawer

The menu drawer was already CSS-only in .NET (a hidden checkbox; `:checked ~ .app-drawer` slides it in), because
the layout was static. So it ported unchanged. Only the two inline `onclick`/`onkeydown` attributes moved to
`public/js/layout.js` – a plain script with `// @ts-check` at the top, so `npm run check` type-checks it against the
browser's DOM types (its own `public/js/tsconfig.json`), with no build step.

### Scoped CSS → one plain file

Blazor's `MainLayout.razor.css` and `NavMenu.razor.css` are **scoped**: the build rewrites selectors so they only
match elements of that component (e.g. `.app-bar[b-x1y2z3]`), and `::deep` pierces into child components. Plain
HTML has no such build step, so both files were merged into `public/css/layout.css` with `::deep` removed. Our class
names (`app-bar`, `drawer-link` …) are unique enough that scoping isn't needed. `app.css` and Bootstrap were copied
unchanged.

## Could this be used with .NET?

The approach, yes: ASP.NET Core can render plain HTML with Razor Pages or MVC views (no circuit), and the
.NET app's Identity pages work exactly like that. The `html` tag itself is JavaScript-only.

## Pitfalls

- Escaping protects HTML text and *quoted* attribute values. It does **not** make a user-provided URL safe in
  `href` (`javascript:…`), and it can't protect unquoted attributes. Always quote attributes; validate URLs.
- `${'a' + b}` is fine, but building HTML with `+` *outside* `html` (`'<b>' + name + '</b>'`) skips escaping.
- Forgetting `html` on a nested template: a plain string is escaped, so the markup shows as text – visible at
  once, at least, and caught by the layout tests.

## Official docs

- MDN, tagged templates: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#tagged_templates
- OWASP XSS prevention cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- Blazor render modes (what we left behind): https://learn.microsoft.com/aspnet/core/blazor/components/render-modes
