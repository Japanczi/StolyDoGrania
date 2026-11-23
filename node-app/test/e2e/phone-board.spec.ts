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
  // Zofia creates a 4-seat table on a desktop browser.
  const zofia = await loggedIn(browser, 'Zofia Wiśniewska');
  await zofia.getByLabel('Nazwa gry nowego stołu').fill('Stół na telefon');
  await zofia.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(zofia.locator('#new-max')).toBeVisible();
  await zofia.locator('#new-max').fill('4');
  await zofia.getByRole('button', { name: 'Utwórz stół' }).click();
  await expect(zofia.locator('#table-rows .table-row', { hasText: 'Stół na telefon' })).toBeVisible();

  const jan = await loggedIn(browser, 'Jan Nowak', phone);
  const row = jan.locator('#table-rows .table-row', { hasText: 'Stół na telefon' });
  const line = row.locator('.row-summary');
  await expect(line).toBeVisible();
  await expect(line).toContainText('1/4');
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

  // A seat taken in the sheet: the sheet and the line both show it, and the line gets the "my seat" edge.
  await sheet.getByRole('button', { name: 'Wolne' }).first().tap();
  await expect(sheet.getByText('Jan Nowak')).toBeVisible();
  await expect(line).toContainText('2/4');
  await expect(row).toHaveClass(/has-my-seat/);

  // Someone else's change arrives live while the sheet is open: the owner marks one seat as taken.
  const taken = zofia.locator('#table-rows .table-row', { hasText: 'Stół na telefon' }).getByLabel('Liczba miejsc oznaczonych jako zajęte: Stół na telefon');
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
