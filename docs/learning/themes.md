# Colour themes: CSS custom properties and a cookie

*Written 2026-11-23, with the three colour themes (Barwy Szczecina, Grafit i bursztyn, Grafit i zieleń).*

## 1. What it is and why we need it

The board got three colour themes and a picker in the menu. Two questions had to be answered:

1. **How does one page switch all its colours at once?** With **CSS custom properties** (often called
   *CSS variables* or *design tokens*). A theme is just a list of named colours set on one element:

   ```css
   :root[data-theme="szczecin"] { --head-bg: #1d4f91; --slot-host-bg: #e7b53c; /* … */ }
   ```

   Everything else in the CSS asks for the colour by name instead of writing a hex value:

   ```css
   .table-head { background: var(--head-bg); }
   .slot-owner { background: var(--slot-host-bg); }
   ```

   Custom properties are *inherited* like `color`: every element inside `<html>` (`:root`) sees them. Change the
   `data-theme` attribute and the browser recomputes every `var()` – the whole page recolours in one step, with no
   new stylesheet and no request.

2. **Where is the choice remembered, and who reads it?** In a **cookie**, because the *server* needs it. The server
   writes `data-theme="…"` into the HTML, so the page is painted in the right colours from the very first frame.

Files:
- `node-app/public/css/themes.css` – the three token sets and how Bootstrap reads them.
- `node-app/src/web/theme.ts` – the list of themes, the default, and `themeFromCookie()`.
- `node-app/src/web/layout.ts` – `data-theme="${theme}"` on `<html>`, and the picker (`themePicker`).
- `node-app/public/js/theme.js` – applies a pick: sets the attribute and the cookie.

## 2. Our code side by side with the C# app

The .NET app had one theme, hard-coded as a class (`git show dotnet:wwwroot/app.css`):

```css
/* .NET: wwwroot/app.css */
.board-theme {
    background-color: #2b2b2e;
    --bs-link-color: #8ab4f8;
    --board-bar-bg: rgba(0, 0, 0, .35);
}
.slot-taken { background: #ad2f69; color: #fff; }   /* Tables.razor.css */
```

It already used a few custom properties (that's how Bootstrap is configured), but most colours were literal values
spread over the files. The Node version moves *every* colour that differs between themes into tokens:

```css
/* Node: public/css/themes.css */
.app[data-theme="amber"]    { --slot-taken-bg: #f4f3ef; --slot-taken-text: #111113; }
.app[data-theme="szczecin"] { --slot-taken-bg: #6b3540; --slot-taken-text: #f3eeef; }

/* Node: public/css/board.css */
.slot-taken { background: var(--slot-taken-bg); color: var(--slot-taken-text); }
```

The server side is three lines in `sendPage` (`src/web/respond.ts`):

```ts
theme: themeFromCookie(request.cookies[themeCookie]),
```

and `themeFromCookie` only ever returns a known id, so a hand-edited cookie can't put anything into the page:

```ts
export function themeFromCookie(value: string | undefined): ThemeId {
  return themes.find(theme => theme.id === value)?.id ?? defaultTheme;
}
```

The browser side (`public/js/theme.js`) is the whole "switch":

```js
document.documentElement.dataset.theme = input.value;            // recolour now
document.cookie = `theme=${input.value}; Path=/; Max-Age=31536000; SameSite=Lax`;  // remember for the server
```

## 3. How it differs from .NET – and could it be used with .NET?

- **Nothing here is Node-specific.** Custom properties are a browser feature; the cookie is plain HTTP. In Blazor
  you would read the cookie in `App.razor` (via `HttpContext` during prerendering) and write
  `<div class="app" data-theme="@theme">` the same way. Blazor would tempt you to keep the theme in a C# field and
  re-render; with tokens there is nothing to re-render – the browser does the work.
- **Cookie vs `localStorage`.** Front-end tutorials often keep the theme in `localStorage`. That is only readable by
  JavaScript, which runs *after* the first paint: the page would flash in the default theme and then flip. A cookie
  goes to the server with every request, so the server renders the right theme. It is the same reason ASP.NET's
  `CookieRequestCultureProvider` keeps the UI language in a cookie.
- **Not HttpOnly, on purpose.** Our session cookie is `HttpOnly` so scripts can't steal it. The theme cookie is set
  *by* a script and holds nothing secret, so it doesn't need to be.
- **No form, no CSRF token.** Changing a theme changes nothing on the server – the cookie is written by the browser
  itself – so there is no request to protect. Saving it per account (in the database) would need a POST with the
  CSRF token like every other change.

## 4. Pitfalls we hit

- **Tokens on the wrong element.** The tokens were first set on `.app`, the page's main element. Custom properties
  are only inherited by an element's *descendants* – and board.js adds some popups (the seat menu, the hour picker)
  straight to `<body>`, outside `.app`. There every `var(--…)` was undefined, so the seat menu came out transparent
  with dark text (reported by the user right after the layout change). Moving `data-theme` to `<html>` (`:root`)
  fixed it for everything at once. A test now checks the popup's computed colours.
- **A rule that skips the variables.** app.css (ported from .NET) set `.btn-primary { background-color: #1b6ec2 }`
  directly, so setting Bootstrap's `--bs-btn-bg` changed nothing: a plain property beats a variable nobody reads.
- **Specificity.** The old `.board-theme` rule set `background-color` and a weave `background-image`. The theme rule
  is `:root[data-theme] .app` (more specific than one class), and it uses the `background`
  *shorthand*, which also resets `background-image` – that is how the weave disappeared without deleting the old rule.
- **One colour, many jobs.** The old `#55555c` was a border in one place, a button in another and the "Inny" table
  kind in a third. A blind search-and-replace would have tied them together; each use had to get a token for its
  *role* (`--line`, `--surface-2`, `--kind-other-bg`), not for its old value.
- **Painting a short line.** The header's dividers are 60% of the bar's height. A `border-left` is always the full
  height, so the divider is a background image instead: `linear-gradient(c, c) left center / 1px 60% no-repeat` – a
  gradient from a colour to the same colour is the usual way to get a sized block of plain colour.
- **A colour that adapts.** The dividers are `rgba(0, 0, 0, .35)`: black at 35%, laid over whatever header colour the
  theme has. One token value works for blue, green and grey bars.

## Links

- MDN: [Using CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
- MDN: [`data-*` attributes and `dataset`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/data-*)
- MDN: [`Document.cookie`](https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie)
- Bootstrap 5: [CSS variables](https://getbootstrap.com/docs/5.3/customize/css-variables/)
- ASP.NET Core: [cookie-based culture provider](https://learn.microsoft.com/aspnet/core/fundamentals/localization/select-language-culture) (the same idea for languages)

## 5. The design B layout (added the same day)

After the themes, the board's layout itself was changed to the mockup's (cover first, chips, a ⋯ menu, a difficulty
bar). Three techniques worth knowing:

- **Placing grid cells by name, not by order.** Each cell got a class (`cell-cover`, `cell-game`, …) and a fixed
  column: `.table-list .table-row > .cell-cover { grid-column: 1; }`. The new-table row hides cells it doesn't need
  yet (`hidden` = `display: none`); with automatic placement the remaining cells would slide left into the gap. In
  Blazor/Razor you'd write the same CSS – this is a browser rule, not a framework one.
- **A menu that escapes a scrolling box.** The table list scrolls sideways (`overflow-x: auto`), and anything inside a
  scrolling box is clipped at its edge – including a dropdown. The ⋯ menu is `position: fixed`, so it is placed against
  the window instead and never clipped. The catch: a fixed box doesn't move when the page scrolls, so board.js places it
  from the button's position (`getBoundingClientRect()`) when it opens and again on every scroll. A first version closed
  the menu on scroll instead – and a Playwright test failed only in the full run: on a long page, Playwright scrolls a
  button into view before clicking it, which closed the menu it was about to click in.
- **Keeping an open menu through live updates.** Rows are patched in place when someone else changes the board
  (`morph.js`). The open menu's cell gets `data-morph-skip`, which morph leaves alone; the next update after it closes
  catches up. The same trick already kept an armed ❌ button armed.

And a small CSS one: the difficulty bar is `linear-gradient(to top, colour 62%, track 62%)` – two colour stops at the
same position give a hard edge instead of a blend, so one gradient draws both the filled part and the empty track.
The server only sends two custom properties (`--difficulty-fill`, `--difficulty-color`); if they're missing (a game
with no difficulty), the gradient is invalid and nothing is drawn – no special case needed.

## 6. Tokens that are not part of a theme; a native select that looks like ours (2026-11-24)

- **Meaning vs mood.** The table kinds got fixed colours (Duży red, Mały white, Inny gray), so their tokens moved out of the
  three theme blocks to plain `:root`: a colour that *means* something must not change when the mood does. The other side
  of that: one colour can't mean two things, so "no hour", also red, became an outline.
- **`appearance: none`** removes the browser's own drawing of a `<select>`, leaving a box we can style; the arrow is two
  gradient triangles in `currentColor`. The *list* it opens stays the browser's: phones show their own picker and the
  keyboard works, which a hand-made list would have to rebuild. Blazor's `<InputSelect>` renders the same `<select>`, so
  the same CSS would work there.
- **Pitfall:** the shorthand `background: red` also resets `background-image` and would erase the arrow – the kinds set
  `background-color`.

- MDN: [`appearance`](https://developer.mozilla.org/en-US/docs/Web/CSS/appearance)
