// Sichtprüfung M4 (nicht Teil der Tests): fliegt in die Hamburger Altstadt, wirft eine 500-kg-
// Fliegerbombe auf ein Haus und misst danach Krater, eingestürzte Gebäude, Partikel und die
// Rechenzeit pro Frame. Erwartet `npm run dev` auf Port 5173.
//
//   OVERPASS_SNAPSHOT=…/hamburg-altstadt.json PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     node scripts/m4-check.mjs [Ausgabeordner]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [outDir = '.'] = process.argv.slice(2);
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const snapshot = process.env.OVERPASS_SNAPSHOT
  ? readFileSync(process.env.OVERPASS_SNAPSHOT, 'utf8')
  : null;
await page.route(/^https:/, async (route) => {
  if (snapshot && route.request().url().includes('/api/interpreter')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    return;
  }
  try {
    await route.fulfill({ response: await route.fetch({ timeout: 30_000 }) });
  } catch {
    await route.abort();
  }
});
const stats = async () => (await page.getByTestId('stats').textContent()) ?? '';
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });

await page.goto('http://localhost:5173/');
await page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill('2026-07-15T14:00');
await page.getByTestId('provider').filter({ hasText: 'Open Data' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(2000);
await page.keyboard.press('Control+k');
await page.keyboard.type(process.env.PLACE ?? 'Rathausmarkt Hamburg');
await page.getByRole('option').first().waitFor({ timeout: 15_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(35_000);
await page.mouse.move(640, 360);
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(800);
}
await page.waitForTimeout(15_000);
console.log('Ankunft:', await stats());

// Mittelhohes Haus nahe der Bildmitte suchen und den Dachmittelpunkt auf den Bildschirm projizieren
const target = await page.evaluate(() => {
  const g = globalThis.__globebox;
  const { camera } = g;
  camera.updateMatrixWorld();
  let best = null;
  for (const cell of g.buildings.loadedCells) {
    const pos = cell.data.positions;
    for (const b of cell.data.buildings) {
      if (b.height < 12 || b.height > 35) continue;
      let maxY = -Infinity;
      for (let k = 0; k < b.vertexCount; k++)
        maxY = Math.max(maxY, pos[(b.vertexStart + k) * 3 + 1]);
      let x = 0,
        z = 0,
        n = 0;
      for (let k = 0; k < b.vertexCount; k++) {
        const s = (b.vertexStart + k) * 3;
        if (pos[s + 1] > maxY - 0.01) {
          x += pos[s];
          z += pos[s + 2];
          n++;
        }
      }
      const v = camera.position
        .clone()
        .set(x / n, maxY, z / n)
        .applyMatrix4(cell.mesh.matrixWorld);
      const ndc = v.clone().project(camera);
      if (Math.abs(ndc.x) > 0.4 || Math.abs(ndc.y) > 0.4 || ndc.z > 1) continue;
      const d = Math.hypot(ndc.x, ndc.y);
      if (!best || d < best.d) best = { d, ndc: [ndc.x, ndc.y], id: b.id, h: b.height };
    }
  }
  return best;
});
console.log('Ziel-Haus:', JSON.stringify(target));
if (!target) process.exit(1);
const px = ((target.ndc[0] + 1) / 2) * 1280;
const py = ((1 - target.ndc[1]) / 2) * 720;
await shot('m4-vorher');

await page.getByTestId('tool-aerial-bomb').click();
await page.locator('#param-aerial-bomb-charge').fill('500');
await page.locator('#param-aerial-bomb-height').fill('300');
await page.waitForTimeout(500);
await page.mouse.click(px, py);
// Software-Rendering ist langsam: auf die Simulation warten statt auf die Uhr
const simTime = () => page.evaluate(() => globalThis.__globebox.tools.physics?.simTime ?? 0);
const waitSim = async (until, timeoutMs = 240_000) => {
  const t0 = Date.now();
  while ((await simTime()) < until && Date.now() - t0 < timeoutMs) await page.waitForTimeout(500);
};
const start = await simTime();
await waitSim(start + 4);
await shot('m4-fall');
await page.waitForFunction(() => globalThis.__globebox.craters.count > 0, null, {
  timeout: 300_000,
  polling: 500,
});
const boom = await simTime();
const toasts = await page.locator('.toast').allTextContents();
console.log('Toasts:', JSON.stringify(toasts));
console.log('Einschlag nach', (boom - start).toFixed(1), 's Simulationszeit');
await waitSim(boom + 0.4);
await shot('m4-einschlag');
await waitSim(boom + 2.5);
await shot('m4-einsturz');

// Blick von schräg oben auf die Einschlagstelle
const view = async (dist, up) =>
  page.evaluate(
    ([dist, up]) => {
      const g = globalThis.__globebox;
      const p = g.tools.physics;
      const c = g.craters.meshes[0];
      const center = c
        ? c.getWorldPosition(c.position.clone())
        : p.bubbleToWorld(p.group.position.clone().set(0, 0, 0));
      const basis = g.origin.basisAt(center);
      g.rig.setMode('fly');
      g.rig.fly.position
        .copy(center)
        .addScaledVector(basis.north, -dist)
        .addScaledVector(basis.up, up);
      g.rig.fly.heading = 0;
      g.rig.fly.pitch = -Math.atan2(up, dist) * (180 / Math.PI);
    },
    [dist, up],
  );
await waitSim(boom + 6);
await view(110, 70);
await waitSim(boom + 15);
await shot('m4-rauchsaeule');
console.log('Nach dem Einschlag:', await stats());

const state = await page.evaluate(() => {
  const g = globalThis.__globebox;
  const d = g.tools.destruction;
  const counts = { damaged: 0, collapsed: 0 };
  for (const s of d.statuses.values()) counts[s]++;
  let fragments = 0,
    loose = 0;
  for (const b of g.tools.physics.allBodies()) {
    if (b.kind !== 'fragment') continue;
    fragments++;
    if (!b.pinned) loose++;
  }
  return {
    ...counts,
    fragments,
    loose,
    craters: g.craters.count,
    masks: g.mask.count,
    particles: g.tools.particleCount,
    bodies: g.tools.physics.bodyCount,
  };
});
console.log('Zerstörung:', JSON.stringify(state));

// Rechenzeit pro Frame (Physik + Zerstörung + Partikel) unabhängig vom Software-Rendering
const ms = await page.evaluate(() => {
  const g = globalThis.__globebox;
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) {
    g.tools.fixedUpdate(1 / 60);
    g.tools.update(1 / 60, 1);
  }
  return (performance.now() - t0) / 60;
});
console.log('Simulation pro Frame (ms):', ms.toFixed(2));
await waitSim(boom + 25);
await shot('m4-danach');
console.log('25 s nach dem Einschlag:', await stats());
await browser.close();
