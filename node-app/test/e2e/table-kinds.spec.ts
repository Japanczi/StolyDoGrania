// End-to-end: the table kinds' colours (feedback 20261124-083849 and -083959): Duży red, Mały white, Inny gray in every
// theme, the owner's selector looks like everyone else's chip, "no hour" is an outline, and a legend explains it.

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

const colours = { small: 'rgb(243, 238, 239)', big: 'rgb(217, 45, 63)', other: 'rgb(92, 92, 98)' } as const;
const clear = 'rgba(0, 0, 0, 0)';

test('table kinds: the same colours in every theme, one chip for owner and guest, "no hour" outlined', async ({ browser }) => {
  const jan = await loggedIn(browser, 'Jan Nowak');
  await jan.getByLabel('Nazwa gry nowego stołu').fill('Kolory stołów');
  await jan.getByLabel('Nazwa gry nowego stołu').press('Tab');
  await expect(jan.locator('#new-max')).toBeVisible();
  await jan.getByRole('button', { name: 'Utwórz stół' }).click();
  const row = jan.locator('#table-rows .table-row', { hasText: 'Kolory stołów' });
  const select = row.getByLabel('Rodzaj stołu: Kolory stołów');
  await expect(select).toHaveCSS('appearance', 'none');

  const guest = await (await browser.newContext()).newPage();
  for (const theme of ['szczecin', 'amber', 'green']) {
    await guest.context().addCookies([{ name: 'theme', value: theme, url: jan.url() }]);
    for (const kind of ['big', 'other', 'small'] as const) {
      await select.selectOption(kind);
      await expect(select).toHaveCSS('background-color', colours[kind]);
      // The kind is saved before the guest's page is loaded.
      await expect(row.locator(`.cell-kind.kind-${kind}`)).toBeVisible();
      await guest.goto('/');
      const chip = guest.locator('#table-rows .table-row', { hasText: 'Kolory stołów' }).locator('.kind-chip');
      await expect(chip).toHaveCSS('background-color', colours[kind]);
      await expect(guest.locator(`.kind-legend .kind-${kind}`)).toHaveCSS('background-color', colours[kind]);
      const [a, b] = [await select.boundingBox(), await chip.boundingBox()];
      expect([a?.width, a?.height]).toEqual([b?.width, b?.height]);
    }
    const hour = guest.locator('#table-rows .table-row', { hasText: 'Kolory stołów' }).locator('.hour-chip');
    await expect(hour).toHaveCSS('background-color', clear);
    await expect(hour).toHaveCSS('border-top-style', 'solid');
  }
  // The cell around "no hour" isn't filled either.
  await expect(row.locator('.cell-hour')).toHaveCSS('background-color', clear);
});
