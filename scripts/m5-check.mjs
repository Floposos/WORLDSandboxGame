// Sichtprüfung M5 (nicht Teil der Tests). Erwartet `npm run dev` auf Port 5173.
//
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/m5-check.mjs <modus> [ordner]
//
// Modi:
//   weather  London, „Echtes Wetter übernehmen“ mit der echten Open-Meteo-Antwort
//   rain     London, Open-Meteo-Antwort durch Regen ersetzt (zeigt Regen und Wolken)
//   tornado  Tornado EF4 durch die Hamburger Altstadt (OVERPASS_SNAPSHOT=…hamburg-altstadt.json)
//   meteor   Meteor 50 m, 20 km/s, 45° auf Hamburg; misst den Krater
//   tools    jedes Werkzeug der Stufen 1 und 4 einmal (Konsolenfehler?)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [mode = 'weather', outDir = '.'] = process.argv.slice(2);
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.text());
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  errors.push(e.message);
});
const snapshot = process.env.OVERPASS_SNAPSHOT
  ? readFileSync(process.env.OVERPASS_SNAPSHOT, 'utf8')
  : null;
const RAIN = {
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
};
let meteoAnswer = null;
await page.route(/^https:/, async (route) => {
  const url = route.request().url();
  if (snapshot && url.includes('/api/interpreter')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    return;
  }
  if (url.includes('api.open-meteo.com') && mode === 'rain') {
    meteoAnswer = RAIN;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RAIN),
    });
    return;
  }
  try {
    const response = await route.fetch({ timeout: 30_000 });
    if (url.includes('api.open-meteo.com')) meteoAnswer = await response.json();
    await route.fulfill({ response });
  } catch {
    await route.abort();
  }
});
const stats = async () => (await page.getByTestId('stats').textContent()) ?? '';
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const simTime = () => page.evaluate(() => globalThis.__globebox.tools.physics?.simTime ?? 0);
const waitSim = async (until, timeoutMs = 300_000) => {
  const t0 = Date.now();
  while ((await simTime()) < until && Date.now() - t0 < timeoutMs) await page.waitForTimeout(500);
};
const toasts = async () => JSON.stringify(await page.locator('.toast').allTextContents());

// Ortssuche über Photon; antwortet sie nicht (in der Sandbox zeitweise gesperrt), fliegt das
// Skript über die Engine direkt zu den Koordinaten (LATLON="53.5503,9.9920").
async function flyTo(place, waitMs = 35_000) {
  const latlon = process.env.LATLON;
  if (!latlon) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(place);
    await page.getByRole('option').first().waitFor({ timeout: 15_000 });
    await page.keyboard.press('Enter');
  } else {
    const [lat, lon] = latlon.split(',').map(Number);
    await page.evaluate(
      ([lat, lon]) =>
        globalThis.__globebox.globeCamera.setPose({
          lat,
          lon,
          height: 600,
          heading: 0,
          pitch: -35,
        }),
      [lat, lon],
    );
  }
  await page.waitForTimeout(waitMs);
}

/** Kamera im Flugmodus an eine Stelle relativ zur Blasenmitte bzw. zu einem Punkt setzen. */
async function view(back, up, at = null) {
  await page.evaluate(
    ([back, up, at]) => {
      const g = globalThis.__globebox;
      const p = g.tools.physics;
      const v = p.group.position.clone();
      const center = at
        ? p.bubbleToWorld(v.set(at[0], at[1], at[2]))
        : p.bubbleToWorld(v.set(0, 0, 0));
      const basis = g.origin.basisAt(center);
      g.rig.setMode('fly');
      g.rig.fly.position
        .copy(center)
        .addScaledVector(basis.north, -back)
        .addScaledVector(basis.up, up);
      g.rig.fly.heading = 0;
      g.rig.fly.pitch = -Math.atan2(up, back) * (180 / Math.PI);
    },
    [back, up, at],
  );
}

/** Klick in die Bildmitte im Globusmodus (Werkzeug muss gewählt sein). */
async function clickCenter() {
  await page.mouse.click(640, 400);
}

await page.goto('http://localhost:5173/');
await page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill('2026-07-15T13:00');
await page.getByTestId('provider').filter({ hasText: 'Open Data' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(2000);

if (mode === 'weather' || mode === 'rain') {
  await flyTo('London Trafalgar Square');
  // Etwas tiefer und geneigt, damit Himmel und Wolken im Bild sind
  await page.mouse.move(640, 360);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(700);
  }
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(640, 360 - i * 16);
    await page.waitForTimeout(300);
  }
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(15_000);
  await shot(`m5-${mode}-vorher`);
  await page.getByTestId('tool-weather').click();
  await page.getByTestId('action-weather-real').click();
  await page
    .locator('.toast', { hasText: /Echtes Wetter|nicht abrufbar/ })
    .first()
    .waitFor({ timeout: 30_000 });
  console.log('Open-Meteo-Antwort:', JSON.stringify(meteoAnswer?.current));
  console.log('Toasts:', await toasts());
  const state = await page.evaluate(() => globalThis.__globebox.weather.current);
  console.log('Wetterzustand:', JSON.stringify(state));
  await page.waitForTimeout(12_000);
  await shot(`m5-${mode}-nachher`);
  const panel = await page.getByTestId('tool-params').textContent();
  console.log('Panel:', panel);
}

if (mode === 'tornado' || mode === 'meteor' || mode === 'tools' || mode === 'tsunami') {
  await flyTo(process.env.PLACE ?? 'Rathausmarkt Hamburg');
  await page.mouse.move(640, 360);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(15_000);
  console.log('Ankunft:', await stats());
}

if (mode === 'tornado') {
  await page.getByTestId('tool-tornado').click();
  await page.locator('#param-tornado-ef').selectOption(process.env.EF ?? '3');
  await page.locator('#param-tornado-radius').fill('60');
  await page.waitForTimeout(500);
  await clickCenter();
  await page.waitForFunction(() => globalThis.__globebox.tools.physics?.frame, null, {
    timeout: 120_000,
  });
  const start = await simTime();
  console.log('Toasts:', await toasts());
  // Kamera auf den Trichter (er wandert)
  const funnelAt = () =>
    page.evaluate(() => {
      const p = globalThis.__globebox.tools.physics;
      const f = p.group.children.find((c) => c.name === 'tornado');
      return f ? [f.position.x, f.position.y, f.position.z] : null;
    });
  for (const [i, t] of [
    [1, 6],
    [2, 14],
    [3, 24],
  ]) {
    await view(300, 120, await funnelAt());
    await waitSim(start + t);
    await shot(`m5-tornado-${i}`);
  }
  const state = await page.evaluate(() => {
    const g = globalThis.__globebox;
    const counts = { damaged: 0, collapsed: 0 };
    for (const s of g.tools.destruction.statuses.values()) counts[s]++;
    let fragments = 0;
    let loose = 0;
    let airborne = 0;
    const p = g.tools.physics;
    for (const b of p.allBodies()) {
      if (b.kind !== 'fragment') continue;
      fragments++;
      if (!b.pinned) loose++;
      if (!b.pinned && b.pos.y - p.groundY(b.pos.x, b.pos.z) > 3) airborne++;
    }
    return { ...counts, fragments, loose, airborne, particles: g.tools.particleCount };
  });
  console.log('Tornado:', JSON.stringify(state));
}

if (mode === 'meteor') {
  await page.getByTestId('tool-meteor').click();
  await page.locator('#param-meteor-diameter').fill('50');
  await page.locator('#param-meteor-speed').fill('20');
  await page.locator('#param-meteor-angle').fill('45');
  await page.waitForTimeout(500);
  await clickCenter();
  await page.waitForFunction(() => globalThis.__globebox.tools.physics?.frame, null, {
    timeout: 120_000,
  });
  const start = await simTime();
  console.log('Toasts:', await toasts());
  await waitSim(start + 2.5);
  await shot('m5-meteor-anflug');
  await page.waitForFunction(() => globalThis.__globebox.craters.count > 0, null, {
    timeout: 300_000,
    polling: 500,
  });
  const boom = await simTime();
  console.log('Einschlag nach', (boom - start).toFixed(1), 's; Toasts:', await toasts());
  await waitSim(boom + 0.5);
  await shot('m5-meteor-einschlag');
  const crater = await page.evaluate(() => {
    const g = globalThis.__globebox;
    const c = g.craters;
    // Krater-Patch (Radius, Tiefe, Wall) aus dem Sampler
    const patches = g.ground.patches.craters;
    const last = patches[patches.length - 1];
    const counts = { damaged: 0, collapsed: 0 };
    for (const s of g.tools.destruction.statuses.values()) counts[s]++;
    return { count: c.count, patch: last, buildings: counts, bodies: g.tools.physics.bodyCount };
  });
  console.log('Krater:', JSON.stringify(crater));
  await waitSim(boom + 8);
  const r = crater.patch?.radiusM ?? 300;
  await view(r * 2.6, r * 1.6);
  await waitSim(boom + 14);
  await shot('m5-meteor-krater');
  await view(r * 1.2, r * 0.45);
  await waitSim(boom + 18);
  await shot('m5-meteor-krater-nah');
}

if (mode === 'tsunami') {
  await page.getByTestId('tool-tsunami').click();
  await page.locator('#param-tsunami-height').fill(process.env.HEIGHT ?? '15');
  await page.waitForTimeout(500);
  await clickCenter();
  await page.waitForFunction(() => globalThis.__globebox.tools.physics?.frame, null, {
    timeout: 120_000,
  });
  const start = await simTime();
  // Kamera seitlich vor die laufende Wellenfront
  const waveAt = () =>
    page.evaluate(() => {
      const p = globalThis.__globebox.tools.physics;
      const w = p.group.children.find((c) => c.name === 'tsunami');
      return w ? [w.position.x, w.position.y, w.position.z] : null;
    });
  for (const [i, t] of [
    [1, 3],
    [2, 8],
    [3, 14],
  ]) {
    await waitSim(start + t);
    const at = await waveAt();
    if (at) await view(Number(process.env.BACK ?? 180), Number(process.env.UP ?? 35), at);
    await page.waitForTimeout(3000);
    console.log(`Welle ${i}:`, JSON.stringify(at));
    await shot(`m5-tsunami-${i}`);
  }
  const state = await page.evaluate(() => {
    const g = globalThis.__globebox;
    const counts = { damaged: 0, collapsed: 0 };
    for (const s of g.tools.destruction.statuses.values()) counts[s]++;
    const w = g.tools.water;
    return { ...counts, wasser: +w.level.toFixed(1), surge: +(w.surge ?? 0).toFixed(1) };
  });
  console.log('Tsunami:', JSON.stringify(state));
}

if (mode === 'tools') {
  const ids = ['time-of-day', 'weather', 'flood', 'gravity', 'earthquake', 'volcano', 'tsunami'];
  for (const id of ids) {
    await page.getByTestId(`tool-${id}`).click();
    await page.waitForTimeout(800);
    if (id === 'weather') {
      await page.locator('#param-weather-preset').selectOption('storm');
      await page.waitForTimeout(3000);
    } else if (id === 'time-of-day') {
      await page.locator('#param-time-of-day-hour').fill('18.5');
    } else if (id === 'gravity') {
      await page.locator('#param-gravity-g').fill('0.3');
    } else {
      await clickCenter();
      await page.waitForFunction(() => globalThis.__globebox.tools.physics?.frame, null, {
        timeout: 120_000,
      });
      const t0 = await simTime();
      await waitSim(t0 + 6);
    }
    console.log(
      id,
      '→',
      await toasts(),
      JSON.stringify(
        await page.evaluate(() => {
          const g = globalThis.__globebox;
          const w = g.tools.water;
          const cones = g.ground.patches.cones.map((c) => [
            Math.round(c.heightM),
            Math.round(c.radiusM),
          ]);
          return {
            wasser: { level: +w.level.toFixed(1), ziel: w.target, sichtbar: w.mesh.visible },
            kegel: cones,
            wetter: g.weather.current.preset,
            objekte: g.tools.physics?.bodyCount ?? 0,
          };
        }),
      ),
    );
    await shot(`m5-tool-${id}`);
  }
}

console.log('Stats:', await stats());
console.log('Konsolenfehler:', errors.length);
await browser.close();
