// End-to-end: the board on a phone (decided 2026-11-23, Resources.txt "Mobile layout of the board", variant C).
// One line per table, no sideways scrolling; tapping a line opens the whole table in a bottom sheet (<dialog>),
// where seats work as on the desktop and live updates keep it current. Back closes the sheet without a reload.

import { expect, test, type Browser, type Page } from '@playwright/test';

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function loggedIn(browser: Browser, userName: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const page = await (await browser.newContext(options)).newPage();
  await page.goto('/Account/Login');
  await page.getByLabel('E-mail lub nazwa użytkownika').fill(userName);
  await page.getByLabel('Hasło').fill('gracz');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByRole('heading', { name: 'Zapisy na gry' })).toBeVisible();
  return page;
}

const mark = (page: Page) => page.evaluate(() => { (globalThis as unknown as { noReload: boolean }).noReload = true; });
const stillSamePage = (page: Page) => page.evaluate(() => (globalThis as unknown as { noReload?: boolean }).noReload === true);

test('phone: tables are one line each, the sheet takes a seat and follows live changes, Back closes it', async ({ browser }) => {
  // Grzegorz creates a 4-seat table on a desktop browser.
  const grzegorz = await loggedIn(browser, 'Grzegorz Brzęczyszczykiewicz');
  await grzegorz.getByLabel('Nazwa gry nowego stołu').fill('Stół na telefon');
  await grzegorz.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(grzegorz.locator('#new-max')).toBeVisible();
  await grzegorz.locator('#new-max').fill('4');
  await grzegorz.getByRole('button', { name: 'Utwórz stół' }).click();
  await expect(grzegorz.locator('#table-rows .table-row', { hasText: 'Stół na telefon' })).toBeVisible();

  const jan = await loggedIn(browser, 'Jan Nowak', phone);
  const row = jan.locator('#table-rows .table-row', { hasText: 'Stół na telefon' });
  const line = row.locator('.row-summary');
  await expect(line).toBeVisible();
  await expect(line).toContainText('1/4');
  // The table kind: a 5px bar the full height of the line, in from the right edge (feedback 2026-11-23).
  const kindBar = await line.locator('.summary-kind').boundingBox();
  const lineBox = await line.boundingBox();
  if (!kindBar || !lineBox) throw new Error('kind bar or line has no box');
  expect(Math.round(kindBar.width)).toBe(5);
  expect(Math.round(kindBar.height)).toBe(Math.round(lineBox.height));
  expect(lineBox.x + lineBox.width - (kindBar.x + kindBar.width)).toBeGreaterThan(4);
  // The wide columns are hidden on a phone, and nothing makes the page scroll sideways.
  await expect(row.locator('.cell-slots')).toBeHidden();
  // (Test files are type-checked without the browser's types, hence the cast.)
  expect(await jan.evaluate(() => {
    const w = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } };
    return w.document.documentElement.scrollWidth <= w.innerWidth;
  })).toBe(true);

  await mark(jan);
  await line.tap();
  const sheet = jan.locator('#table-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.game-name')).toHaveText('Stół na telefon');
  // Not Jan's table: no "⋯" actions menu for him.
  await expect(sheet.getByRole('button', { name: 'Opcje stołu' })).toBeHidden();

  // A seat taken in the sheet: the sheet and the line both show it, and the line gets the "my seat" edge.
  await sheet.getByRole('button', { name: 'Wolne' }).first().tap();
  await expect(sheet.getByText('Jan Nowak')).toBeVisible();
  await expect(line).toContainText('2/4');
  await expect(row).toHaveClass(/has-my-seat/);

  // Someone else's change arrives live while the sheet is open: the owner marks one seat as taken.
  const taken = grzegorz.locator('#table-rows .table-row', { hasText: 'Stół na telefon' }).getByLabel('Liczba miejsc oznaczonych jako zajęte: Stół na telefon');
  await taken.fill('1');
  await taken.press('Tab');
  await expect(sheet.locator('.slot-blocked')).toHaveCount(1);
  await expect(line).toContainText('3/4');

  // The phone's Back button closes the sheet and stays on the board, without reloading it.
  await jan.goBack();
  await expect(sheet).toBeHidden();
  expect(new URL(jan.url()).pathname).toBe('/');
  expect(await stillSamePage(jan)).toBe(true);
});

test('phone: "+ Nowy stół" opens the new-table form in the sheet; creating closes it and shows the line', async ({ browser }) => {
  const malgorzata = await loggedIn(browser, 'Małgorzata Szczepańska-Dąbrowska', phone);
  // On a phone the new-table row is not in the list; the button is.
  await expect(malgorzata.locator('#table-list > #draft')).toBeHidden();
  const open = malgorzata.getByRole('button', { name: '+ Nowy stół' });
  await expect(open).toBeVisible();

  await mark(malgorzata);
  await open.tap();
  const sheet = malgorzata.locator('#table-sheet');
  await expect(sheet).toBeVisible();
  const name = sheet.getByLabel('Nazwa gry nowego stołu');
  await expect(name).toBeFocused();

  // Closing keeps what was typed (the row goes back to the list, hidden), reopening shows it again.
  await name.fill('Stół z telefonu');
  await name.press('Enter');
  await expect(sheet.locator('#new-max')).toBeVisible();
  await malgorzata.goBack();
  await expect(sheet).toBeHidden();
  await open.tap();
  await expect(sheet.getByLabel('Nazwa gry nowego stołu')).toHaveValue('Stół z telefonu');

  await sheet.locator('#new-max').fill('3');
  await sheet.getByRole('button', { name: 'Utwórz stół' }).tap();
  await expect(sheet).toBeHidden();
  const line = malgorzata.locator('#table-rows .table-row', { hasText: 'Stół z telefonu' }).locator('.row-summary');
  await expect(line).toBeVisible();
  await expect(line).toContainText('1/3');
  await expect(malgorzata.getByText('Utworzono stół: Stół z telefonu.')).toBeVisible();
  expect(new URL(malgorzata.url()).pathname).toBe('/');
  expect(await stillSamePage(malgorzata)).toBe(true);

  // Her own table: the "⋯" menu lists the actions with labels; the two-tap delete works from there.
  await line.tap();
  const menu = sheet.getByRole('button', { name: 'Opcje stołu' });
  await expect(menu).toBeVisible();
  const deleteButton = sheet.locator('[data-action="delete"]');
  await expect(deleteButton).toBeHidden();
  // The menu floats over the sheet: opening it doesn't change the sheet's size (asked 2026-11-23).
  const heightBefore = (await sheet.boundingBox())?.height;
  await menu.tap();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(deleteButton).toBeVisible();
  // (Within a pixel: layout sizes are floats, e.g. 397.5 vs 397.50006.)
  expect((await sheet.boundingBox())?.height).toBeCloseTo(heightBefore ?? 0, 0);
  // A tap outside the menu closes it; ⋯ opens it again.
  await sheet.locator('.cell-slots').tap();
  await expect(deleteButton).toBeHidden();
  await menu.tap();
  await expect(deleteButton).toBeVisible();
  await expect(sheet.locator('[data-action="rename"]')).toBeVisible();
  await expect(sheet.locator('.action-placeholder').first()).toBeHidden();

  // "Zmień grę" opens the rename popup as a layer attached to that button (just above or below it), on screen.
  const renameButton = sheet.locator('[data-action="rename"]');
  await renameButton.tap();
  const popup = sheet.locator('.action-popup');
  await expect(popup).toBeVisible();
  await expect(popup.getByLabel('Nazwa gry')).toBeFocused();
  const b = await renameButton.boundingBox();
  const p = await popup.boundingBox();
  if (!b || !p) throw new Error('rename button or popup has no box');
  const attached = Math.abs(b.y - (p.y + p.height) - 4) <= 2 || Math.abs(p.y - (b.y + b.height) - 4) <= 2;
  expect(attached).toBe(true);
  expect(p.y).toBeGreaterThanOrEqual(0);
  expect(p.y + p.height).toBeLessThanOrEqual(phone.viewport.height);
  await popup.getByRole('button', { name: 'Anuluj' }).tap();
  await expect(popup).toHaveCount(0);

  // A real rename closes everything – the popup, the ⋯ menu and the sheet (feedback 2026-11-23: "close all boxes").
  await renameButton.tap();
  const newName = popup.getByLabel('Nazwa gry');
  await newName.fill('Stół po zmianie');
  await newName.press('Enter');
  await popup.getByRole('button', { name: 'Zapisz' }).tap();
  await expect(sheet).toBeHidden();
  await expect(malgorzata.getByText('Zmieniono grę stołu: Stół z telefonu → Stół po zmianie.')).toBeVisible();
  const renamedLine = malgorzata.locator('#table-rows .table-row', { hasText: 'Stół po zmianie' }).locator('.row-summary');
  await expect(renamedLine).toBeVisible();

  // Back in: delete it through the menu.
  await renamedLine.tap();
  await menu.tap();
  await deleteButton.tap();
  await expect(deleteButton).toHaveClass(/armed/);
  await deleteButton.tap();
  await expect(sheet).toBeHidden();
  await expect(malgorzata.locator('#table-rows .table-row', { hasText: 'Stół po zmianie' })).toHaveCount(0);
  expect(await stillSamePage(malgorzata)).toBe(true);
});

test('phone: the "Dodaj gracza" popup stays in the visible part of the screen, above the on-screen keyboard', async ({ browser }) => {
  const jan = await loggedIn(browser, 'Jan Nowak', phone);
  await jan.getByRole('button', { name: '+ Nowy stół' }).tap();
  await jan.getByLabel('Nazwa gry nowego stołu').fill('Dodawanie na telefonie');
  await jan.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(jan.locator('#new-max')).toBeVisible();
  await jan.locator('#new-max').fill('4');
  await jan.getByRole('button', { name: 'Utwórz stół' }).tap();
  const line = jan.locator('#table-rows .table-row', { hasText: 'Dodawanie na telefonie' }).locator('.row-summary');
  await line.tap();
  const sheet = jan.locator('#table-sheet');
  // force (below) doesn't wait for the sheet's slide-in, so wait for it here.
  await sheet.evaluate(el => Promise.all(
    (el as unknown as { getAnimations(): { finished: Promise<unknown> }[] }).getAnimations().map(a => a.finished)).then(() => undefined));
  // force: the seat is aria-disabled (the owner can't take it); a long press (contextmenu) still opens the popup.
  await sheet.locator('[data-slot="4"]').click({ button: 'right', force: true });
  const popup = jan.locator('.add-player');
  await expect(popup).toBeVisible();
  // Opening it doesn't bring up the keyboard (which would cover the list of players): nothing is typed in yet.
  await expect(popup.locator('input[name="name"]')).not.toBeFocused();

  // Playwright has no on-screen keyboard. A real one shrinks window.visualViewport but not 100vh / innerHeight.
  const visible = 300;
  await jan.evaluate(height => {
    const w = globalThis as unknown as { visualViewport: { dispatchEvent(e: unknown): void }; Event: new (type: string) => unknown };
    Object.defineProperty(w.visualViewport, 'height', { configurable: true, get: () => height });
    w.visualViewport.dispatchEvent(new w.Event('resize'));
  }, visible);
  for (const part of [popup, popup.locator('.add-player-title'), popup.getByRole('button', { name: 'Dodaj', exact: true })]) {
    const box = await part.boundingBox();
    if (!box) throw new Error('no box');
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(visible);
  }

  await popup.locator('input[name="name"]').fill('Gość Testowy');
  await popup.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(sheet.getByText('Gość Testowy')).toBeVisible();
});

test('phone: swiping while the sheet is open does not scroll the board underneath', async ({ browser }) => {
  const jan = await loggedIn(browser, 'Jan Nowak', phone);
  // A long page, whatever tables the other tests have left, and not at its top.
  await jan.addStyleTag({ content: '.app-main { padding-bottom: 3000px }' });
  type Win = { scrollY: number; scrollTo(x: number, y: number): void };
  await jan.evaluate(() => (globalThis as unknown as Win).scrollTo(0, 60));
  const scrollY = () => jan.evaluate(() => (globalThis as unknown as Win).scrollY);
  // Real touch input (Chromium's own protocol): a swipe up from the given point.
  const cdp = await jan.context().newCDPSession(jan);
  const swipe = async (y: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y }] });
    for (let moved = 15; moved <= 150; moved += 15) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y - moved }] });
      await jan.waitForTimeout(16);
    }
    // The finger rests before lifting: after a flung swipe Chromium may swallow the next tap (with or without a sheet).
    for (let i = 0; i < 20; i++) {
      await jan.waitForTimeout(16);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y - 150 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await jan.waitForTimeout(100);
  };

  await jan.getByRole('button', { name: '+ Nowy stół' }).tap();
  const sheet = jan.locator('#table-sheet');
  await expect(sheet).toBeVisible();
  await sheet.evaluate(el => Promise.all(
    (el as unknown as { getAnimations(): { finished: Promise<unknown> }[] }).getAnimations().map(a => a.finished)).then(() => undefined));
  // Tapping may itself have scrolled the button into view: compare with where the page is now.
  const before = await scrollY();
  expect(before).toBeGreaterThan(0);
  await swipe(300); // on the dimmed board above the sheet
  expect(await scrollY()).toBe(before);
  await swipe(825); // on the sheet itself
  expect(await scrollY()).toBe(before);

  // Closed: the page is where it was, and scrolls again.
  await sheet.getByRole('button', { name: 'Zamknij' }).tap();
  await expect(sheet).toBeHidden();
  expect(await scrollY()).toBe(before);
  await swipe(600);
  expect(await scrollY()).toBeGreaterThan(before);
});

test('phone: dragging the sheet down by its top strip closes it; a short drag springs back', async ({ browser }) => {
  const jan = await loggedIn(browser, 'Jan Nowak', phone);
  const sheet = jan.locator('#table-sheet');
  const settled = () => sheet.evaluate(el => Promise.all(
    (el as unknown as { getAnimations(): { finished: Promise<unknown> }[] }).getAnimations().map(a => a.finished)).then(() => undefined));
  const open = async () => {
    await jan.getByRole('button', { name: '+ Nowy stół' }).tap();
    await expect(sheet).toBeVisible();
    await settled();
  };
  const cdp = await jan.context().newCDPSession(jan);
  /** A touch drag of the handle by dy, in steps; the finger rests before lifting unless it's a flick. */
  const dragHandle = async (dy: number, flick = false) => {
    const grip = await sheet.locator('.sheet-grip').boundingBox();
    if (!grip) throw new Error('no grip');
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    const touch = (type: 'touchStart' | 'touchMove', to: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x, y: to }] });
    await touch('touchStart', y);
    // Each simulated move takes a couple of frames, so a flick is two big ones.
    const steps = flick ? 2 : 5;
    for (let i = 1; i <= steps; i++) await touch('touchMove', y + dy * i / steps);
    if (!flick) await jan.waitForTimeout(200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  await open();
  const before = await sheet.boundingBox();
  await dragHandle(50);
  await settled();
  await expect(sheet).toBeVisible();
  expect(await sheet.boundingBox()).toEqual(before);
  await dragHandle(-80);
  await settled();
  expect(await sheet.boundingBox()).toEqual(before);

  // (The sheet is low here: from its handle to the screen's bottom there is room for just over 100px.)
  await dragHandle(110);
  await expect(sheet).toBeHidden();
  // Opens again in its place, and a quick short flick closes it too.
  await open();
  expect(await sheet.boundingBox()).toEqual(before);
  await dragHandle(80, true);
  await expect(sheet).toBeHidden();
  expect(new URL(jan.url()).pathname).toBe('/');

  // The buttons in the strip still work.
  await open();
  await sheet.getByRole('button', { name: 'Zamknij' }).tap();
  await expect(sheet).toBeHidden();
});
