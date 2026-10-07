// Sichtprüfung Bildqualität, Nachtlicht und Gebäudeabdeckung (nicht Teil der Tests).
// Erwartet `npm run dev` auf Port 5173.
//
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/quality-check.mjs <modus> [ordner]
//
// Modi:
//   light      Berlin aus 2 km und 300 m: Mittag im Oktober, 22 Uhr; dazu 22 Uhr aus 3 000 km
//   buildings  Berlin-Mitte aus 1,5 km (OVERPASS_SNAPSHOT=…berlin-mitte.json), zählt Gebäude
// LATLON=<lat>,<lon> wählt den Ort (Standard: Berlin-Mitte).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [mode = 'light', outDir = '.'] = process.argv.slice(2);
const [LAT, LON] = (process.env.LATLON ?? '52.5163,13.3777').split(',').map(Number);
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const snapshot = process.env.OVERPASS_SNAPSHOT
  ? readFileSync(process.env.OVERPASS_SNAPSHOT, 'utf8')
  : null;
await page.route(/^https:/, async (route) => {
  const url = route.request().url();
  if (snapshot && url.includes('/api/interpreter')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    return;
  }
  try {
    await route.fulfill({ response: await route.fetch({ timeout: 30_000 }) });
  } catch {
    await route.abort();
  }
});

const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const setPose = (pose) =>
  page.evaluate((p) => {
    const g = globalThis.__globebox;
    g.rig.setMode('globe');
    g.globeCamera.setPose(p);
  }, pose);
const setTime = (iso) => page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill(iso);
/** Mittlere Helligkeit (0…255) der Bildmitte, ohne UI. */
const brightness = async () => {
  // Aus dem Screenshot (der WebGL-Puffer selbst ist nach dem Zeichnen leer)
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const g = document.createElement('canvas');
    g.width = 64;
    g.height = 36;
    const x = g.getContext('2d');
    const w = img.width;
    const h = img.height;
    x.drawImage(img, w * 0.25, h * 0.2, w * 0.5, h * 0.5, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4)
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return Math.round(s / (d.length / 4));
  }, png);
};
const settle = (ms) => page.waitForTimeout(ms);

await page.goto('http://localhost:5173/');
await page.getByTestId('provider').filter({ hasText: 'Open Data' }).waitFor({ timeout: 30_000 });
await settle(3000);

if (mode === 'light') {
  for (const [name, iso, height, pitch] of [
    ['mittag-2km', '2026-10-06T12:00', 2_000, -90],
    ['mittag-300m', '2026-10-06T12:00', 300, -50],
    ['nacht-2km', '2026-10-06T22:00', 2_000, -90],
    ['nacht-300m', '2026-10-06T22:00', 300, -50],
    ['nacht-3000km', '2026-10-06T22:00', 3_000_000, -90],
  ]) {
    await setTime(iso);
    await setPose({ lat: LAT, lon: LON, height, heading: 0, pitch });
    await settle(height > 100_000 ? 8000 : 25_000);
    await shot(`licht-${name}`);
    console.log(name, 'Helligkeit', await brightness());
  }
}

if (mode === 'buildings') {
  await setTime('2026-07-15T13:00');
  await setPose({ lat: LAT - 0.008, lon: LON, height: 1_500, heading: 0, pitch: -40 });
  for (let i = 0; i < 6; i++) {
    await settle(10_000);
    const n = await page.evaluate(() => globalThis.__globebox.buildings.loadedCells.length);
    const stats = await page.getByTestId('stats').textContent();
    console.log(`nach ${(i + 1) * 10} s: ${n} Zellen ·`, stats?.match(/[\d.]+ Gebäude/)?.[0]);
  }
  await shot('gebaeude-1500m');
}

console.log('Seitenfehler:', errors.length);
await browser.close();
