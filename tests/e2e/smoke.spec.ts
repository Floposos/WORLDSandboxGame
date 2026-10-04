import { expect, test } from '@playwright/test';

test('M0: leere Szene mit FPS-Anzeige ohne Konsolenfehler', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  // Kein Test darf echte externe APIs ansprechen: alles außer localhost abfangen.
  await page.route(/^(?!http:\/\/localhost)/, (route) => route.abort());

  await page.goto('/');
  await expect(page.locator('canvas#scene')).toBeVisible();
  await expect(page.getByTestId('stats')).toBeVisible();
  await expect
    .poll(async () => Number(await page.getByTestId('fps').textContent()), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('attribution')).toBeVisible();
  expect(errors).toEqual([]);
});
