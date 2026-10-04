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
    if (url.includes('/api/interpreter')) {
      return route.fulfill({ body: '{"elements":[]}', contentType: 'application/json' });
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
  // Nach dem Flug: Kamera wenige km südlich der Zugspitze (47,42° N / 10,98° O), Blick nach Norden.
  await expect(page.getByTestId('hud')).toContainText(/47,(39|40|41)\d\d° N/, { timeout: 15_000 });
  await expect(page.getByTestId('hud')).toContainText('10,98');
  expect(errors).toEqual([]);
});

test('Kameramodi: Bodenkamera steht 1,8 m über Grund und sinkt beim Gehen nicht ein', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await mockNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('provider')).toContainText('Open Data', { timeout: 20_000 });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Zugspitze');
  await expect(page.getByRole('option').first()).toContainText('Zugspitze', { timeout: 5_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('hud')).toContainText(/47,(39|40|41)\d\d° N/, { timeout: 15_000 });

  // Suchliste ist nach der Auswahl zu, Fokus liegt nicht mehr im Suchfeld
  await expect(page.getByRole('option')).toHaveCount(0);

  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-ground')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hud')).toContainText('1,8 m über Grund', { timeout: 10_000 });
  const before = await page.getByTestId('hud').textContent();

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2_000);
  await page.keyboard.up('KeyW');
  await expect(page.getByTestId('hud')).toContainText('1,8 m über Grund');
  // Die Position hat sich bewegt (Koordinaten im HUD ändern sich)
  await expect.poll(async () => page.getByTestId('hud').textContent()).not.toBe(before);

  await page.keyboard.press('2');
  await expect(page.getByTestId('mode-fly')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mode-hint')).toContainText('Q/E');
  await page.getByTestId('mode-globe').click();
  await expect(page.getByTestId('mode-globe')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('Werkzeugleiste aus der Registry, Kiste landet per Klick in der Physik', async ({ page }) => {
  const errors = collectErrors(page);
  await mockNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('provider')).toContainText('Open Data', { timeout: 20_000 });
  // Stufe 0 (6 Werkzeuge) und Stufe 2 (4 Werkzeuge)
  await expect(page.getByTestId('toolbar').getByRole('button')).toHaveCount(10);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('Zugspitze');
  await expect(page.getByRole('option').first()).toContainText('Zugspitze', { timeout: 5_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('hud')).toContainText(/47,(39|40|41)\d\d° N/, { timeout: 15_000 });
  // Näher heran (Werkzeuge wirken unter 5 km über Grund)
  await page.mouse.move(640, 360);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1_500);

  await page.getByTestId('tool-place-box').click();
  await expect(page.getByTestId('tool-params')).toContainText('Kantenlänge');
  await expect(page.getByTestId('tool-place-box')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(640, 360);
  await expect(page.getByTestId('bodies')).toContainText(/^1 /, { timeout: 20_000 });

  // Esc wählt das Werkzeug ab
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-params')).toHaveCount(0);
  // Leertaste pausiert im Globusmodus (ADR-018)
  await page.keyboard.press('Space');
  await expect(page.getByTestId('paused')).toBeVisible();
  expect(errors).toEqual([]);
});
