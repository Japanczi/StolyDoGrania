// End-to-end: "Zmień grę" offers the new-table row's details too (decided 2026-11-23): kind, seat count, hour, seats
// marked as taken. The hour picker opens *on top of* the rename popup, which stays open; Escape closes the innermost.

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

test('renaming a table sets its details too, from the same fields as a new table', async ({ browser }) => {
  const page = await loggedIn(browser, 'Grzegorz Brzęczyszczykiewicz');
  await page.getByLabel('Nazwa gry nowego stołu').fill('Przed zmianą');
  await page.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(page.locator('#new-max')).toBeVisible();
  await page.locator('#new-max').fill('4');
  await page.getByRole('button', { name: 'Utwórz stół' }).click();
  const row = page.locator('#table-rows .table-row', { hasText: 'Przed zmianą' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Opcje stołu: Przed zmianą' }).click();
  await row.getByRole('button', { name: 'Zmień grę: Przed zmianą' }).click();
  const popup = page.getByRole('dialog', { name: 'Zmień grę' });
  await expect(popup).toBeVisible();
  // Starts at the table's current values.
  await expect(popup.getByLabel('Rodzaj stołu')).toHaveValue('small');
  await expect(popup.getByLabel('Liczba graczy')).toHaveValue('4');
  await expect(popup.getByLabel('Godzina spotkania')).toHaveText('--:--');

  await popup.getByLabel('Nazwa gry').fill('Po zmianie');
  await popup.getByLabel('Nazwa gry').press('Enter');
  await popup.getByLabel('Rodzaj stołu').selectOption('big');
  await popup.getByLabel('Liczba graczy').fill('5');
  await popup.getByLabel('Liczba miejsc oznaczonych jako zajęte').fill('2');

  // The hour picker opens over the rename popup; picking an hour closes only the picker.
  await popup.getByLabel('Godzina spotkania').click();
  const hours = page.locator('.hour-popup');
  await expect(hours).toBeVisible();
  await hours.getByRole('button', { name: '19:45' }).click();
  await expect(hours).toHaveCount(0);
  await expect(popup).toBeVisible();
  await expect(popup.getByLabel('Godzina spotkania')).toHaveText('19:45');

  // Escape closes the innermost popup first.
  await popup.getByLabel('Godzina spotkania').click();
  await expect(hours).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hours).toHaveCount(0);
  await expect(popup).toBeVisible();

  await popup.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Zmieniono grę stołu: Przed zmianą → Po zmianie.')).toBeVisible();
  const renamed = page.locator('#table-rows .table-row', { hasText: 'Po zmianie' });
  await expect(renamed.locator('.cell.kind-big')).toHaveCount(1);
  await expect(renamed.getByRole('button', { name: 'Godzina spotkania: Po zmianie' })).toHaveText('19:45');
  await expect(renamed.locator('.slot')).toHaveCount(5);
  await expect(renamed.locator('.slot-blocked')).toHaveCount(2);
});
