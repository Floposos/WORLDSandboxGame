import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

/** Feste Open-Meteo-Antwort (Regen); echte APIs spricht kein Test an. */
const openMeteo = JSON.stringify({
  current: {
    time: '2026-10-05T12:00',
    interval: 900,
    temperature_2m: 11.2,
    precipitation: 1.4,
    rain: 1.4,
    snowfall: 0,
    cloud_cover: 100,
    wind_speed_10m: 7.5,
    wind_direction_10m: 225,
    is_day: 1,
    weather_code: 63,
  },
});

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
    if (url.includes('api.open-meteo.com')) {
      return route.fulfill({ body: openMeteo, contentType: 'application/json' });
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
  await expect(page.getByTestId('attribution')).toContainText('EOxCloudless', { timeout: 10_000 });
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

test('Werkzeugleiste aus der Registry, Kiste landet in der Physik, Granate explodiert', async ({
  page,
}) => {
  // Physik, Explosion und Wetter-Shader brauchen mit Software-Rendering länger als das
  // Standard-Zeitlimit, besonders wenn mehrere Tests parallel laufen.
  test.slow();
  const errors = collectErrors(page);
  await mockNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('provider')).toContainText('Open Data', { timeout: 20_000 });
  // Stufe 0 (6 Werkzeuge), 1 (4), 2 (4), 3 (4), 4 (5) und 5 (3)
  await expect(page.getByTestId('toolbar').getByRole('button')).toHaveCount(26);

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

  // Nach einer Parametereingabe liegt der Fokus wieder bei der Szene
  const material = page.getByTestId('tool-params').locator('select').first();
  await material.focus();
  await material.selectOption({ index: 1 });
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('SELECT');

  // Granate (Stufe 3): Explosion mit Bilanz-Toast und Partikeln, ohne Shader-Fehler
  await page.getByTestId('tool-grenade').click();
  await page.locator('#param-grenade-fuse').fill('1');
  await page.mouse.click(640, 360);
  await expect(page.locator('.toast').filter({ hasText: 'kg TNT' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('particles')).not.toContainText(/^0 /, { timeout: 5_000 });

  // Stufe 1: „Echtes Wetter übernehmen“ setzt Regen (Antwort aus der Fixture)
  await page.getByTestId('tool-weather').click();
  await page.getByTestId('action-weather-real').click();
  await expect(page.locator('.toast').filter({ hasText: 'Echtes Wetter' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('#param-weather-preset')).toHaveValue('rain');
  await expect(page.getByTestId('attribution')).toContainText('Open-Meteo');

  // Esc wählt das Werkzeug ab
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-params')).toHaveCount(0);
  // Leertaste pausiert im Globusmodus (ADR-018)
  await page.keyboard.press('Space');
  await expect(page.getByTestId('paused')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Stufe 5: Hinweis beim ersten Mal, Mega-Bombe aus dem All, Welt zurücksetzen', async ({
  page,
}) => {
  test.slow();
  const errors = collectErrors(page);
  await mockNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('provider')).toContainText('Open Data', { timeout: 20_000 });

  await page.getByTestId('tool-mega-bomb').click();
  // Erst offen abwarten: der Text steht schon vor showModal() im DOM, ein zu frühes Esc
  // ginge ins Leere und der Dialog blockierte danach die Werkzeugleiste.
  await expect(page.getByTestId('apocalypse-hint')).toBeVisible();
  await expect(page.getByTestId('apocalypse-hint')).toContainText('fiktive');
  // Esc schließt nur den Hinweis, das Werkzeug bleibt gewählt
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('apocalypse-hint')).toBeHidden();
  await expect(page.getByTestId('tool-mega-bomb')).toHaveAttribute('aria-pressed', 'true');
  // Der Hinweis kommt nur einmal
  await page.getByTestId('tool-asteroid').click();
  await expect(page.getByTestId('tool-params')).toContainText('Durchmesser');
  await expect(page.getByTestId('apocalypse-hint')).toBeHidden();

  // Aus der Startansicht (Globus aus großer Höhe) zielt die Mega-Bombe auf den Globus
  await page.getByTestId('tool-mega-bomb').click();
  // Logarithmischer Regler rastet auf runden Werten ein
  await page.locator('#param-mega-bomb-yield').fill('3');
  await expect(page.getByTestId('tool-params')).toContainText('1 Mt');
  await page.mouse.click(640, 360);
  await expect(page.locator('.toast').filter({ hasText: '1 Mt TNT' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('.toast').filter({ hasText: 'TNT' })).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('reset-world').click();
  await expect(page.locator('.toast').filter({ hasText: 'zurückgesetzt' })).toBeVisible({
    timeout: 10_000,
  });

  // Mond-Absturz: Werkzeuge und Kameramodi ruhen, Tasten 2/3 verlassen die Globusansicht nicht
  await page.getByTestId('tool-moon-drop').click();
  await page.getByTestId('action-moon-drop-start').click();
  await expect(page.getByTestId('cinematic')).toBeVisible();
  await expect(page.getByTestId('toolbar')).toHaveCount(0);
  await page.keyboard.press('Digit2');
  await page.keyboard.press('Digit3');
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { __globebox: { rig: { mode: string } } }).__globebox.rig.mode,
    ),
  ).toBe('globe');
  expect(errors).toEqual([]);
});
