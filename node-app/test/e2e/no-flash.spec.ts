// End-to-end: in-page actions update the page in place – no reload, so nothing flashes (requested 2026-11-11).
// How it's proven: a marker is put on `window` before the action; a page reload would throw it away. And elements
// that didn't change (a row, its cover) must be the very same DOM nodes afterwards, not replacements.

import { expect, test, type Browser, type Page } from '@playwright/test';

async function loggedIn(browser: Browser, userName: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/Account/Login');
  await page.getByLabel('E-mail lub nazwa użytkownika').fill(userName);
  await page.getByLabel('Hasło').fill('gracz');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByRole('heading', { name: 'Zapisy na gry' })).toBeVisible();
  return page;
}

/** Marks the page so a reload can be detected. */
const mark = (page: Page) => page.evaluate(() => { (globalThis as unknown as { noReload: boolean }).noReload = true; });
const stillSamePage = (page: Page) => page.evaluate(() => (globalThis as unknown as { noReload?: boolean }).noReload === true);

test('changing a table\'s kind patches the row in place: no reload, same row and cover elements', async ({ browser }) => {
  const jan = await loggedIn(browser, 'Jan Nowak');
  await jan.getByLabel('Nazwa gry nowego stołu').fill('Gra bez migania');
  await jan.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(jan.locator('#new-max')).toBeVisible();
  await jan.getByRole('button', { name: 'Utwórz stół' }).click();
  // Only the table rows (the new-table row's name suggestions contain the title too).
  const row = jan.locator('#table-rows .table-row', { hasText: 'Gra bez migania' });
  await expect(row).toBeVisible();

  await mark(jan);
  // Tag the row's elements so we can tell afterwards whether they were kept or replaced.
  await row.evaluate(el => {
    (el as unknown as { tag: string }).tag = 'row';
    (el.querySelector('.thumb') as unknown as { tag: string }).tag = 'cover';
  });

  await row.getByLabel('Rodzaj stołu: Gra bez migania').selectOption('big');
  await expect(row.locator('.cell.kind-big')).toBeVisible();

  expect(await stillSamePage(jan)).toBe(true);
  expect(await row.evaluate(el => (el as unknown as { tag?: string }).tag)).toBe('row');
  expect(await row.evaluate(el => (el.querySelector('.thumb') as unknown as { tag?: string }).tag)).toBe('cover');
});

test('renaming a user on the admin page happens in place: no reload, the address stays right', async ({ browser }) => {
  const szef = await loggedIn(browser, 'Szef');
  await szef.goto('/admin/users');
  await mark(szef);

  const row = szef.locator('tr', { hasText: 'Zofia Wiśniewska' });
  await row.getByRole('link', { name: 'Zmień nazwę' }).click();
  const input = szef.getByLabel('Nowa nazwa użytkownika: Zofia Wiśniewska');
  await expect(input).toBeFocused();
  expect(szef.url()).toContain('/admin/users?zmien=');

  await input.fill('Zofia W');
  await input.press('Enter');
  await expect(szef.getByText('Zmieniono nazwę użytkownika Zofia Wiśniewska na Zofia W.')).toBeVisible();
  await expect(szef.locator('tr', { hasText: 'Zofia W' })).toBeVisible();

  expect(await stillSamePage(szef)).toBe(true);
  expect(new URL(szef.url()).pathname).toBe('/admin/users');

  // An invalid name keeps the form open with the error – still without a reload.
  await szef.locator('tr', { hasText: 'Zofia W' }).getByRole('link', { name: 'Zmień nazwę' }).click();
  await szef.getByLabel('Nowa nazwa użytkownika: Zofia W').fill('a@b');
  await szef.getByLabel('Nowa nazwa użytkownika: Zofia W').press('Enter');
  await expect(szef.getByText(/Nazwa użytkownika: 3–20 znaków/).first()).toBeVisible();
  expect(await stillSamePage(szef)).toBe(true);
});

test('"Pokaż e-mail" fetches one address in place: no reload; an in-place update hides it again', async ({ browser }) => {
  const szef = await loggedIn(browser, 'Szef');
  await szef.goto('/admin/users');
  await expect(szef.getByText('gracz1@example.com')).toHaveCount(0);
  await mark(szef);

  const row = szef.locator('tr', { hasText: 'Jan Nowak' });
  await row.getByRole('link', { name: 'Pokaż e-mail' }).click();
  await expect(row.getByText('gracz1@example.com')).toBeVisible();
  expect(await stillSamePage(szef)).toBe(true);
  expect(new URL(szef.url()).search).toBe(''); // the JavaScript path, not the ?email= fallback

  // Another action morphs the server's HTML in ("Usuń" only asks for confirmation): the address is hidden again.
  await row.getByRole('link', { name: 'Usuń' }).click();
  await expect(row.getByRole('button', { name: 'Potwierdź usunięcie' })).toBeVisible();
  await expect(row.getByRole('link', { name: 'Pokaż e-mail' })).toBeVisible();
  await expect(row.getByText('gracz1@example.com')).toHaveCount(0);
  expect(await stillSamePage(szef)).toBe(true);
});
