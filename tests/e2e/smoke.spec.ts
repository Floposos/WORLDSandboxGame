import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

/**
 * Kein Test darf echte externe APIs ansprechen: Kacheln und Geocoder werden aus Fixtures
 * bedient, alles andere außer localhost wird abgebrochen.
 */
async function mockNetwork(page: Page): Promise<void> {
  const terrain = fixture('terrarium-flat.png');
  const imagery = fixture('imagery-plain.png');
  const photon = fixture('photon-zugspitze.json');
  await page.route(/^(?!http:\/\/localhost)/, (route) => {
    const url = route.request().url();
    if (url.includes('elevation-tiles-prod')) {
      return route.fulfill({ body: terrain, contentType: 'image/png' });
    }
    if (url.includes('tiles.maps.eox.at') || url.includes('gibs.earthdata.nasa.gov')) {
      return route.fulfill({ body: imagery, contentType: 'image/png' });
    }
    if (url.includes('photon.komoot.io')) {
      return route.fulfill({ body: photon, contentType: 'application/json' });
    }
    return route.abort();
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('Globus startet mit Open Data, FPS-Anzeige und Quellenangabe ohne Konsolenfehler', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mockNetwork(page);
  await page.goto('/');
  await expect(page.locator('canvas#scene')).toBeVisible();
  await expect
    .poll(async () => Number(await page.getByTestId('fps').textContent()), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('provider')).toContainText('Open Data', { timeout: 20_000 });
  await expect(page.getByTestId('attribution')).toContainText('Sentinel-2', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('Suche fliegt zur Zugspitze', async ({ page }) => {
  const errors = collectErrors(page);
  await mockNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('provider')).toContainText('Open Data', { timeout: 20_000 });
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('Zugspitze');
  await expect(page.getByRole('option').first()).toContainText('Zugspitze', { timeout: 5_000 });
  await page.keyboard.press('Enter');
  // Nach dem Flug: Koordinaten nahe 47,42° N / 10,98° O und Höhe deutlich unter 100 km.
  await expect(page.getByTestId('hud')).toContainText('47,42', { timeout: 15_000 });
  await expect(page.getByTestId('hud')).toContainText('10,98');
  expect(errors).toEqual([]);
});
