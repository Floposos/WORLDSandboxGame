// Sichtprüfung M3 (nicht Teil der Tests): fliegt nach Berlin-Mitte, wirft 200 Kisten auf ein
// Hausdach und misst danach FPS und Kistenzahl. Erwartet `npm run dev` auf Port 5173.
//
//   OVERPASS_SNAPSHOT=…/berlin-mitte.json PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
//     node scripts/m3-check.mjs [Ausgabeordner]
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
const hud = async () => (await page.getByTestId('hud').textContent()) ?? '';
const stats = async () => (await page.getByTestId('stats').textContent()) ?? '';

await page.goto('http://localhost:5173/');
await page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill('2026-07-15T15:00');
await page.getByTestId('provider').filter({ hasText: 'Open Data' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(2000);
await page.keyboard.press('Control+k');
await page.keyboard.type(process.env.PLACE ?? 'Gendarmenmarkt Berlin');
await page.getByRole('option').first().waitFor({ timeout: 15_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(35_000);
console.log('Ankunft:', await hud(), '|', await stats());

// Kamera tiefer und näher (Globusmodus, Mausrad)
await page.mouse.move(640, 360);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(800);
}
await page.waitForTimeout(15_000);
console.log('Näher:', await hud(), '|', await stats());

// Dach eines Gebäudes nahe der Bildmitte suchen und auf den Bildschirm projizieren
const target = await page.evaluate(() => {
  const g = globalThis.__globebox;
  const { camera } = g;
  camera.updateMatrixWorld();
  let best = null;
  for (const cell of g.buildings.loadedCells) {
    const pos = cell.data.positions;
    for (const b of cell.data.buildings) {
      if (b.height < 12 || b.height > 40) continue;
      // Dach = Eckpunkte mit größtem y; Mittelpunkt davon
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
      if (Math.abs(ndc.x) > 0.5 || Math.abs(ndc.y) > 0.5 || ndc.z > 1) continue;
      const d = Math.hypot(ndc.x, ndc.y);
      if (!best || d < best.d) best = { d, ndc: [ndc.x, ndc.y], id: b.id, h: b.height };
    }
  }
  return best;
});
console.log('Ziel-Dach:', JSON.stringify(target));
if (!target) process.exit(1);
const px = ((target.ndc[0] + 1) / 2) * 1280;
const py = ((1 - target.ndc[1]) / 2) * 720;

await page.getByTestId('tool-place-box').click();
await page.locator('#param-place-box-count').fill('200');
await page.waitForTimeout(500);
await page.mouse.click(px, py);
await page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill('2026-07-15T15:00');
// Nahansicht: Flugkamera 30 m vor und 18 m über dem Stapel, Blick darauf
await page.evaluate(() => {
  const g = globalThis.__globebox;
  const p = g.tools.physics;
  const c = p.group.position.clone().set(0, 0, 0);
  let n = 0;
  for (const b of p.allBodies()) {
    c.add(b.pos);
    n++;
  }
  c.multiplyScalar(1 / Math.max(1, n));
  const center = p.bubbleToWorld(c);
  const basis = g.origin.basisAt(center);
  g.rig.setMode('fly');
  const cam = center.clone().addScaledVector(basis.north, -30).addScaledVector(basis.up, 18);
  g.rig.fly.position.copy(cam);
  g.rig.fly.heading = 0;
  g.rig.fly.pitch = -31;
});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/kisten-fallen.png` });
await page.waitForTimeout(20_000);
console.log('Nach 30 s:', await stats());
const state = await page.evaluate(() => {
  const p = globalThis.__globebox.tools.physics;
  let sleeping = 0,
    frozen = 0,
    maxY = -Infinity,
    minY = Infinity;
  for (const b of p.allBodies()) {
    if (b.frozen) frozen++;
    else if (b.rb?.isSleeping()) sleeping++;
    maxY = Math.max(maxY, b.pos.y);
    minY = Math.min(minY, b.pos.y);
  }
  return { bodies: p.bodyCount, sleeping, frozen, minY, maxY, colliders: p.buildingColliderCount };
});
console.log('Physik:', JSON.stringify(state));
await page.screenshot({ path: `${outDir}/kisten-liegen.png` });

// Physik-Schrittzeit mit den 200 Kisten (unabhängig vom Software-Rendering)
const stepMs = await page.evaluate(() => {
  const p = globalThis.__globebox.tools.physics;
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) p.step(1 / 60);
  return (performance.now() - t0) / 60;
});
console.log('Physik-Schritt (ms):', stepMs.toFixed(2));

// Auto auf die Straße stellen und fahren
await page.getByTestId('tool-place-car').click();
await page.waitForTimeout(500);
const carHit = await page.evaluate(async () => {
  const g = globalThis.__globebox;
  const p = g.tools.physics;
  // Freie Straßenfläche suchen: senkrechter Raycast trifft Gelände, nicht Gebäude/Körper
  const V = p.group.position.constructor;
  let spot = null;
  for (let r = 25; r < 250 && !spot; r += 15) {
    for (let a = 0; a < 16 && !spot; a++) {
      const x = Math.cos((a / 16) * Math.PI * 2) * r;
      const z = Math.sin((a / 16) * Math.PI * 2) * r;
      const from = p.bubbleToWorld(new V(x, 200, z));
      const to = p.bubbleToWorld(new V(x, -50, z));
      const dir = to.clone().sub(from).normalize();
      const ray = { origin: from, direction: dir };
      const hit = p.raycast({
        ...ray,
        clone() {
          return this;
        },
      });
      if (!hit || hit.buildingId !== null || hit.body) continue;
      // 8 m rundum frei?
      let free = true;
      for (const [dx, dz] of [
        [6, 0],
        [-6, 0],
        [0, 6],
        [0, -6],
      ]) {
        const f2 = p.bubbleToWorld(new V(x + dx, 200, z + dz));
        const t2 = p.bubbleToWorld(new V(x + dx, -50, z + dz));
        const h2 = p.raycast({ origin: f2, direction: t2.clone().sub(f2).normalize() });
        if (!h2 || h2.buildingId !== null) free = false;
      }
      if (free) spot = { x, z, point: hit.point };
    }
  }
  if (!spot) return 'kein Platz';
  const basis = g.origin.basisAt(spot.point);
  g.rig.fly.position.copy(spot.point).addScaledVector(basis.up, 30);
  g.rig.fly.pitch = -89;
  await new Promise((r) => setTimeout(r, 1500));
  await g.tools.use({ x: 0, y: 0 });
  return g.tools.driving.active;
});
console.log('Fahrmodus aktiv:', carHit);
await page.waitForTimeout(3000);
const before = await page.evaluate(() =>
  globalThis.__globebox.tools.driving.current?.body.pos.toArray(),
);
await page.keyboard.down('KeyW');
await page.waitForTimeout(6000);
await page.keyboard.down('KeyA');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => {
  const car = globalThis.__globebox.tools.driving.current;
  return car ? { pos: car.body.pos.toArray(), speed: car.speed } : null;
});
console.log('Auto vorher', JSON.stringify(before), 'nachher', JSON.stringify(after));
await page.screenshot({ path: `${outDir}/auto-faehrt.png` });
await browser.close();
