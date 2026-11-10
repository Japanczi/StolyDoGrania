// End-to-end: two people in two separate browsers see each other's changes on the board without reloading –
// the one feature no server-side test can prove (proposal, section 6). Uses the Development test users
// (password "gracz", Data/IdentitySeeder.cs).

import { expect, test, type Browser, type Page } from '@playwright/test';

async function loggedIn(browser: Browser, userName: string): Promise<Page> {
  // A new context = a separate browser profile with its own cookies.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/Account/Login');
  await page.getByLabel('E-mail lub nazwa użytkownika').fill(userName);
  await page.getByLabel('Hasło').fill('gracz');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByRole('heading', { name: 'Zapisy na gry' })).toBeVisible();
  return page;
}

test('a table created in one browser appears in another, and seats update live both ways', async ({ browser }) => {
  const jan = await loggedIn(browser, 'Jan Nowak');
  const zofia = await loggedIn(browser, 'Zofia Wiśniewska');

  // Jan creates a table; Zofia's page shows it without a reload.
  await jan.getByLabel('Nazwa gry nowego stołu').fill('Gra na żywo');
  await jan.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(jan.locator('#new-max')).toBeVisible();
  await jan.getByRole('button', { name: 'Utwórz stół' }).click();
  await expect(jan.getByText('Utworzono stół: Gra na żywo.')).toBeVisible();
  await expect(zofia.locator('.table-row', { hasText: 'Gra na żywo' })).toBeVisible();

  // Zofia takes the second seat; Jan sees her name appear.
  const zofiasRow = zofia.locator('.table-row', { hasText: 'Gra na żywo' });
  await zofiasRow.locator('[data-slot="2"]').click();
  await expect(jan.locator('.table-row', { hasText: 'Gra na żywo' }).getByText('Zofia Wiśniewska')).toBeVisible();

  // Jan (the owner) frees her seat; Zofia sees it free again.
  await jan.locator('.table-row', { hasText: 'Gra na żywo' }).getByTitle('Zwolnij miejsce: Zofia Wiśniewska').click();
  await expect(zofiasRow.locator('[data-slot="2"]')).toHaveText('Wolne');

  // Jan deletes the table with the two-click button; it disappears from Zofia's page.
  const deleteButton = jan.locator('.table-row', { hasText: 'Gra na żywo' }).locator('[data-action="delete"]');
  await deleteButton.click();
  await deleteButton.click();
  await expect(zofia.locator('.table-row', { hasText: 'Gra na żywo' })).toHaveCount(0);
});
