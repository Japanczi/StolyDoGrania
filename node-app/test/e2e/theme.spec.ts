// End-to-end: picking a colour theme in the menu recolours the page in place (no reload, the same board
// element), and the next page load is rendered in that theme by the server (cookie), not flipped afterwards.

import { expect, test } from '@playwright/test';

test('picking a theme recolours in place and is remembered for the next page', async ({ page }) => {
  await page.goto('/');
  const app = page.locator('html');
  await expect(app).toHaveAttribute('data-theme', 'szczecin');
  const head = page.locator('.table-head');
  await expect(head).toHaveCSS('background-color', 'rgb(29, 79, 145)');

  // Mark the page and the header element: a reload would lose both.
  await page.evaluate(() => { (globalThis as unknown as { noReload: boolean }).noReload = true; });
  await page.locator('.table-head').evaluate(el => { (el as unknown as { tag: string }).tag = 'head'; });

  await page.locator('label[for="app-menu-toggle"].app-menu-button').click();
  await page.getByLabel('Grafit i zieleń').check();

  await expect(app).toHaveAttribute('data-theme', 'green');
  await expect(head).toHaveCSS('background-color', 'rgb(23, 112, 63)');
  expect(await page.evaluate(() => (globalThis as unknown as { noReload?: boolean }).noReload)).toBe(true);
  expect(await page.locator('.table-head').evaluate(el => (el as unknown as { tag?: string }).tag)).toBe('head');

  // A fresh load comes from the server already in the chosen theme.
  const response = await page.reload();
  expect(await response?.text()).toContain('data-theme="green"');
  await expect(page.getByLabel('Grafit i zieleń')).toBeChecked();
});

test('popups added outside the page body get the theme too (the seat menu was transparent)', async ({ browser }) => {
  // Szef is an admin: a right-click on a free seat opens the "add player" popup, which board.js adds to <body>.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/Account/Login');
  await page.getByLabel('E-mail lub nazwa użytkownika').fill('Szef');
  await page.getByLabel('Hasło').fill('gracz');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.getByLabel('Nazwa gry nowego stołu').fill('Stół z menu miejsca');
  await page.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(page.locator('#new-max')).toBeVisible();
  await page.locator('#new-max').fill('3');
  await page.getByRole('button', { name: 'Utwórz stół' }).click();

  const row = page.locator('#table-rows .table-row', { hasText: 'Stół z menu miejsca' });
  // force: the seat is aria-disabled for a left click (the owner can't take it), which Playwright would wait out;
  // a right-click on it still opens the popup.
  await row.locator('[data-slot="2"]').click({ button: 'right', force: true });
  const popup = page.locator('.add-player');
  await expect(popup).toBeVisible();
  // Szczecin's popup colour (#2a1217), not transparent.
  await expect(popup).toHaveCSS('background-color', 'rgb(42, 18, 23)');
  await expect(popup).toHaveCSS('color', 'rgb(243, 238, 239)');
});
