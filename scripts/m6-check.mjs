// Sichtprüfung M6 (nicht Teil der Tests). Erwartet `npm run dev` auf Port 5173.
//
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/m6-check.mjs <modus> [ordner]
//
// Modi:
//   space     Mega-Bombe 50 Mt aus 1 500 km Höhe auf Hamburg, Bilder aus dem All
//   bomb      Mega-Bombe 100 kt in der Blase (OVERPASS_SNAPSHOT=…hamburg-altstadt.json), Pilzwolke
//   asteroid  Asteroid 10 km aus der Globusansicht, Verdunkelung, danach „Welt zurücksetzen“
//   moon      Mond-Absturz als Sequenz bis zum Reset-Angebot, dann zurücksetzen
// LATLON=<lat>,<lon> wählt das Ziel (Standard: Hamburger Altstadt).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [mode = 'space', outDir = '.'] = process.argv.slice(2);
const [LAT, LON] = (process.env.LATLON ?? '53.544,9.995').split(',').map(Number);
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[browser]', m.text());
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  errors.push(e.message);
});
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
const toasts = async () => JSON.stringify(await page.locator('.toast').allTextContents());
const fxTime = () => page.evaluate(() => globalThis.__globebox.tools.globeFx.elapsed);
const simTime = () => page.evaluate(() => globalThis.__globebox.tools.physics?.simTime ?? 0);
const waitFx = async (dt, timeoutMs = 400_000) => {
  const until = (await fxTime()) + dt;
  const t0 = Date.now();
  while ((await fxTime()) < until && Date.now() - t0 < timeoutMs) await page.waitForTimeout(500);
};
const setPose = (pose) =>
  page.evaluate((p) => {
    const g = globalThis.__globebox;
    g.rig.setMode('globe');
    g.globeCamera.setPose(p);
  }, pose);
const state = () =>
  page.evaluate(() => {
    const g = globalThis.__globebox;
    const fx = g.tools.globeFx;
    return {
      gloom: +fx.gloom.toFixed(2),
      overlay: fx.overlay.mesh.visible,
      active: fx.active,
      zerstoert: g.tools.destruction
        ? [...g.tools.destruction.statuses.values()].filter((s) => s === 'collapsed').length
        : 0,
    };
  });
/** Schieberegler setzen (Playwright lehnt Werte ab, die nicht auf dem Raster liegen). */
const setRange = (id, v) =>
  page.evaluate(
    ([id, v]) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [id, v],
  );
/** Werkzeug wählen und den Hinweis der Stufe 5 bestätigen. */
async function pick(id) {
  await page.getByTestId(`tool-${id}`).click();
  const hint = page.getByTestId('apocalypse-hint-ok');
  try {
    await hint.waitFor({ timeout: 5000 });
    await shot('m6-hinweis');
    await hint.click();
    await hint.waitFor({ state: 'hidden' });
  } catch {
    // Hinweis schon bestätigt
  }
  await page.waitForTimeout(500);
}

await page.goto('http://localhost:5173/');
await page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill('2026-07-15T13:00');
await page.getByTestId('provider').filter({ hasText: 'Open Data' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(3000);

if (mode === 'space') {
  await setPose({ lat: LAT, lon: LON, height: 1_500_000, heading: 0, pitch: -90 });
  await page.waitForTimeout(8000);
  await pick('mega-bomb');
  await setRange('param-mega-bomb-yield', Math.log10(50_000));
  await page.waitForTimeout(500);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1500);
  console.log('Toasts:', await toasts());
  await waitFx(1);
  await shot('m6-space-blitz');
  await waitFx(8);
  await shot('m6-space-1500km');
  await setPose({ lat: LAT, lon: LON, height: 300_000, heading: 0, pitch: -60 });
  await page.waitForTimeout(6000);
  await shot('m6-space-300km');
  await setPose({ lat: LAT - 20, lon: LON, height: 7_000_000, heading: 0, pitch: -90 });
  await page.waitForTimeout(6000);
  await shot('m6-space-7000km');
  console.log('Zustand:', JSON.stringify(await state()));
}

if (mode === 'bomb') {
  await setPose({ lat: LAT - 0.03, lon: LON, height: 2_500, heading: 0, pitch: -30 });
  await page.waitForTimeout(25_000);
  await pick('mega-bomb');
  await setRange('param-mega-bomb-yield', Math.log10(100));
  await page.waitForTimeout(500);
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => globalThis.__globebox.tools.physics?.frame, null, {
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
  console.log('Toasts:', await toasts());
  for (const [i, dt] of [
    [1, 2],
    [2, 6],
    [3, 12],
  ]) {
    await waitFx(dt);
    await shot(`m6-bomb-${i}`);
  }
  await setPose({ lat: LAT - 0.35, lon: LON, height: 25_000, heading: 0, pitch: -25 });
  await page.waitForTimeout(5000);
  await shot('m6-bomb-weit');
  console.log('Zustand:', JSON.stringify(await state()), 'Sim', await simTime());
}

if (mode === 'asteroid') {
  await setPose({ lat: LAT - 15, lon: LON, height: 9_000_000, heading: 0, pitch: -90 });
  await page.waitForTimeout(8000);
  await pick('asteroid');
  // Ziel: Bildmitte liegt 15° südlich; ein Stück nach oben klicken trifft Norddeutschland
  await page.mouse.click(640, 250);
  await page.waitForTimeout(1000);
  console.log('Toasts:', await toasts());
  await waitFx(4);
  await shot('m6-asteroid-anflug');
  await waitFx(4);
  await shot('m6-asteroid-einschlag');
  await waitFx(20);
  await shot('m6-asteroid-staub');
  console.log('Zustand:', JSON.stringify(await state()));
  await setPose({ lat: LAT + 2, lon: LON + 8, height: 3_000, heading: 200, pitch: -10 });
  await page.waitForTimeout(8000);
  await shot('m6-asteroid-boden');
  await page.getByTestId('reset-world').click();
  await page.waitForTimeout(4000);
  await shot('m6-asteroid-reset');
  console.log('Nach Reset:', JSON.stringify(await state()), await toasts());
}

if (mode === 'moon') {
  await setPose({ lat: LAT, lon: LON, height: 12_000_000, heading: 0, pitch: -90 });
  await page.waitForTimeout(6000);
  await pick('moon-drop');
  await page.getByTestId('action-moon-drop-start').click();
  const t0 = await fxTime();
  for (const [name, t] of [
    ['anflug', 6],
    ['nahe', 13],
    ['roche', 16],
    ['einschlag', 19],
    ['glut', 25],
  ]) {
    const now = await fxTime();
    await waitFx(Math.max(0, t0 + t - now));
    const caption = await page
      .getByTestId('cinematic')
      .textContent()
      .catch(() => null);
    console.log(name, ((await fxTime()) - t0).toFixed(1), caption);
    await shot(`m6-mond-${name}`);
  }
  await page.getByTestId('cinematic-reset').waitFor({ timeout: 300_000 });
  await shot('m6-mond-ende');
  console.log('Ende:', JSON.stringify(await state()));
  await page.getByTestId('cinematic-reset').click();
  await page.waitForTimeout(5000);
  await shot('m6-mond-reset');
  console.log('Nach Reset:', JSON.stringify(await state()), await toasts());
}

console.log('Konsolenfehler:', errors.length);
await browser.close();
