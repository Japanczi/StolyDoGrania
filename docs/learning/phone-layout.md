# A phone layout: media queries, `<dialog>` and the History API

*Added 2026-11-23 (the board's phone layout, step 1: the list and the sheet; step 2: the new-table form; step 3: the "⋯" menu). Files:
[`node-app/public/css/board.css`](../../node-app/public/css/board.css) (section "Phones and portrait tablets"),
[`node-app/public/js/board.js`](../../node-app/public/js/board.js) (section "the phone sheet"),
[`node-app/src/web/pages/board/view.ts`](../../node-app/src/web/pages/board/view.ts) (`rowSummary`, the `<dialog>`),
[`node-app/src/web/layout.ts`](../../node-app/src/web/layout.ts) (the `js` class); test:
[`node-app/test/e2e/phone-board.spec.ts`](../../node-app/test/e2e/phone-board.spec.ts).*

## What it is and why we need it

The board is a 10-column grid about 1050px wide. On a 375px phone you saw the game name and a sliver of the hour; the
seats – the reason anyone opens the page – were 700px to the right. The chosen design (variant C, Resources.txt
"Mobile layout of the board") is a list with **one line per table** and a **bottom sheet** with the whole table when
you tap a line.

Nothing here is Node-specific: it is all browser technology – CSS, HTML and a little JavaScript – and would work the
same under Blazor. Four pieces:

| Piece | What it does for us |
|---|---|
| **Media query** `@media (max-width: 991.98px)` | Switches the board to the list below Bootstrap's `lg` width (phones and portrait tablets) |
| **The `js` class** on `<html>` | Lets CSS use the list only when JavaScript runs (the sheet needs it) |
| **`<dialog>` + `showModal()`** | The sheet: backdrop, focus, Escape and "everything else is unclickable" come from the browser |
| **History API** `pushState` / `popstate` | The phone's Back button closes the sheet instead of leaving the page |

## One page, two layouts: media queries

There is still **one** HTML page with the same URL. Each table row now also contains a summary button
(`rowSummary()` in `view.ts`): hour, name, "2/4", a dot in the table-kind colour. CSS decides what is shown:

```css
.row-summary { display: none; }                       /* desktop: the line is hidden */

@media (max-width: 991.98px) {                         /* narrower than Bootstrap's lg */
    html.js .table-list .table-row:not(.table-draft) > .cell { display: none; }   /* hide the 10 columns */
    html.js .row-summary { display: flex; }                                      /* show the line */
}
```

`991.98px` rather than `992px` is Bootstrap's convention: its `lg` styles start *at* 992, so "below lg" must stop
just short of it (browsers can have fractional widths when zoomed).

**The alternative we didn't take:** detecting phones on the server (from the `User-Agent` header) and rendering
different HTML. That means two templates to keep in step, wrong guesses for tablets and resized windows, and caching
problems. CSS knows the *actual* width, every time.

## "Only with JavaScript": the `js` class

The sheet needs JavaScript. Without it, the list lines would be buttons that do nothing, so the phone layout must
apply only when JavaScript runs. The classic trick: a one-line inline script in `<head>`:

```html
<script>document.documentElement.classList.add('js');</script>
```

It runs **before the body is drawn**, so the CSS rules under `html.js` are in force on the first paint – the phone
never briefly shows the wide table first. Putting the same line in `board.js` (at the end of `<body>`) would be too
late: the browser may already have painted. Without JavaScript the class never appears and the old wide table stays
(scrolling sideways, but usable).

## The sheet: a native `<dialog>`

```html
<dialog class="table-sheet" id="table-sheet" aria-label="Szczegóły stołu"> … </dialog>
```

```js
sheet.showModal();   // open as a modal
sheet.close();       // close (fires the 'close' event)
```

`showModal()` gives us, for free, what we would otherwise write by hand (the hour picker and the "add player" popup
in `board.js` still do it by hand – compare `showPopup()`):

- a **backdrop** (styled with the `::backdrop` pseudo-element);
- the dialog in the **top layer**, above everything, with no `z-index` fights;
- **Escape** closes it (it fires a `cancel` event first, which can be prevented);
- everything outside it becomes **inert** – not clickable, not focusable;
- focus moves into the dialog, and back to the button when it closes.

A tap on the dimmed area is reported as a click **on the `<dialog>` element itself** (its content is inside a
wrapper), which is how `board.js` closes the sheet on a tap outside:

```js
if (target === sheet || target.closest('[data-sheet-close]')) sheet.close();
```

### Keeping one source of truth

The sheet shows a **copy** of the table's row (`row.cloneNode(true)`, with the id changed to `sheet-table-12` so ids
stay unique). The row remains the single thing the server renders and live updates patch. After every refresh,
`syncSheet()` morphs the copy to match the row again – the same `morph.js` as everywhere else, so nothing flashes.
The seat buttons in the copy work because the board's click listener is on `#board` (event delegation): it only
checks that the clicked element is in a row *or in the sheet* (`inRows`). Server-side rights are unchanged – the
copy contains exactly the buttons the server rendered for this viewer, and every action is re-checked on the server.

In Blazor this would have been a component rendered in two places (`<TableRow>` in the list and in a dialog), both
re-rendered from the same data. Here the browser has only HTML, so "render it twice" becomes "copy it and keep the copy
in step".

### The new-table form: moved, not copied (step 2)

"+ Nowy stół" (phones only) opens the new-table row in the same sheet. This time the row is **moved**, not copied:

```js
sheetBody.replaceChildren(draftRow, draftPanel);            // open: the elements move into the sheet
rowContainers[1].before(draftRow, draftPanel);              // close: back to their place in the list
```

Moving a DOM element keeps everything attached to it: its event listeners, what the user typed, the lookup's
state. That's why closing the sheet halfway and opening it again shows the half-filled form. A copy would have lost
all of that, and the row's listeners (set up once in `setUpDraft()`) would only work on the original. The table rows
are different: live updates patch them, so the sheet needs a copy that is re-synced; the new-table row is never
touched by live updates, so it can simply move.

Inside the sheet, CSS rearranges the form with `display: contents`: the row's own box (and its name cell's box)
disappear, and their children become items of the sheet's grid, so `order` can put the name field first, the
lookup messages under it, the details in two columns and the buttons last – without changing the HTML.

### The "⋯" menu: showing existing buttons, not building new ones (step 3)

On the desktop the owner's and admin's actions are tiny emoji buttons in the row's first column (❌ 🏷️, plus three
disabled 🛠️ placeholders). In the sheet they are now behind a "⋯" button in its top-left corner. The menu builds
nothing: it toggles a class (`menu-open`) on the sheet's body, and CSS shows the row's own actions cell as a
floating list of labelled buttons, hiding the placeholders. So the buttons are exactly the server-rendered ones,
with the same listeners – including the two-click delete.

It floats *over* the sheet (`position: absolute` against `.sheet-inner`, which is `position: relative`), so the sheet
keeps its size. The first version showed the list inside the sheet's flow and pushed everything down; the user asked
for a layer over it instead. A press outside the menu closes it (a capture-phase `pointerdown` listener, like the
armed ❌), and Escape closes it before closing the sheet.

Each button gets its label from its own `title` attribute:

```css
.table-sheet .action-button::after { content: attr(title); }
```

`attr()` reads an attribute into generated content, and it follows changes: when the ❌ is armed, board.js sets its
title to "Kliknij ponownie, aby usunąć stół", and the label in the menu changes with it – no extra code.

The ⋯ button appears only when the copied row has an enabled action button – which the server renders only for the
table's owner or an admin. The client never decides who may do what; it only reacts to what the server sent
(the rights are re-checked on the server for every action anyway).

## The Back button: the History API

On a phone, Back is how people close things. Without help, Back would leave the board. So opening the sheet adds a
history entry *without changing the URL*:

```js
history.pushState({ sheet: id }, '');               // open: a new entry, same URL
window.addEventListener('popstate', () => {          // Back pressed: the entry is gone…
  if (sheet.open) sheet.close();                     // …so just close the sheet
});
sheet.addEventListener('close', () => {              // closed some other way (✕, tap outside, Escape)…
  if (history.state?.sheet) history.back();          // …remove the entry we added
});
```

**.NET counterpart:** Blazor's `NavigationManager` handles navigation *between pages*; for an "entry without a new
page" you'd call the same browser API through JS interop (`IJSRuntime`). MAUI/Android apps have a hardware Back
event instead.

## How it differs from .NET, and could it be used there?

- **Everything here could be used with .NET unchanged**: media queries, `<dialog>`, `::backdrop`, the History API and
  the `js` class are browser features. A Blazor app could use `<dialog>` with one line of JS interop for
  `showModal()`.
- **What Blazor would have done differently:** state like "which table is open" would live in a C# field and the
  dialog would be rendered from it. In our server-rendered app, state that only matters to this one browser
  (an open sheet) lives in the browser, and the server never knows about it.
- **Component libraries** (MudBlazor, Radzen) ship their own dialogs built from `<div>`s and JavaScript. The native
  element now does most of that, with better accessibility by default.

## Pitfalls we hit

1. **A colour rule beaten by specificity.** In the sheet every cell got a grey background, and the kind cell lost its
   green: `.table-sheet .table-row > .cell` (3 classes) beats `.kind-small` (1 class). Fix: wrap the grey rule in
   `:where(…)`, which matches the same elements but counts as **zero** specificity, so `.kind-small` wins again.
2. **`history.back()` is asynchronous.** Closing a sheet and opening another within a few hundred milliseconds
   meant the late `popstate` from the first close arrived *after* the new sheet opened – and closed it. Fix: a
   `backPending` flag; the new sheet adds its history entry only after our own `back()` has finished.
3. **`transform` breaks `position: fixed` inside it.** The hour picker inside the sheet is `position: fixed`. Any
   `transform` (or `translate`) on an ancestor makes "fixed" relative to that ancestor instead of the screen. So the
   sheet's slide-in animation uses `translate` only *during* the animation (a keyframe `from`, no fill), and the
   resting sheet has none.
4. **Popups outside a modal are dead.** `showModal()` makes the rest of the page inert – including the hour picker,
   which `board.js` used to append to `<body>`. Popups now go into the open sheet (`popupHost()`). Positions meant
   for the desktop didn't fit either: the rename popup (360px, placed beside its 🏷️ button) ran past the right edge
   and below the screen – found while testing. First fix: spanning the width at the top of the screen. The user
   wanted it as a layer attached to its button instead, so now `followButton()` in board.js places it right above
   the "Zmień grę" button (below it if the button is in the upper half of the screen) and limits its height to the
   room there. Above, because the on-screen keyboard comes up from the bottom. It is placed again once the sheet's
   slide-in animation has finished (`sheet.getAnimations()` → `.finished`), and whenever the sheet scrolls or the
   screen changes size (`resize`, and `visualViewport`'s `resize`, which fires when a keyboard opens). Focusing its
   field uses `focus({ preventScroll: true })`, so the browser doesn't scroll the sheet to the field first.
5. **Escape closed two things at once.** The first Escape should close the hour picker, not the whole sheet. The
   board's Escape handler calls `preventDefault()` when it closed a popup, which stops the dialog's own `cancel`.

6. **The moved form got the rows' click handling.** The board's click listener handles `[data-action]` buttons in
   rows and in the sheet; the new-table row's hour button has `data-action="hour"` too. Once that row was in the
   sheet, a click would have been sent as "change the hour of table NaN". `inRows()` now leaves the sheet out while
   it shows the new-table form.
7. **Step 2's test exposed three older live-update races** (a click silently dropped, an armed ❌ disarmed by a
   live update, refreshes finishing out of order). They are described in
   [live-updates.md](live-updates.md#pitfalls-we-hit).

## Testing it

Playwright can pretend to be a phone: `browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
isMobile: true })`, then `locator.tap()` instead of `click()` and `page.goBack()` for the Back button.
`phone-board.spec.ts` checks: one line per table, no sideways scroll, a seat taken in the sheet, a live change from
another browser arriving in the open sheet, and Back closing it without a reload. A second test creates a table on
a phone: "+ Nowy stół", the form keeping what was typed after Back and reopening, the sheet closing on success and
the new line appearing. The tests use test users no other test renames, because the e2e tests run in parallel
against one database (another test renames "Zofia Wiśniewska").

## Official docs

- MDN: [Using media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Using_media_queries)
- MDN: [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) and
  [`::backdrop`](https://developer.mozilla.org/en-US/docs/Web/CSS/::backdrop)
- MDN: [Working with the History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API)
- MDN: [`:where()`](https://developer.mozilla.org/en-US/docs/Web/CSS/:where) and
  [Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Specificity)
- Bootstrap: [Breakpoints](https://getbootstrap.com/docs/5.3/layout/breakpoints/)
- Playwright: [Emulation](https://playwright.dev/docs/emulation)
