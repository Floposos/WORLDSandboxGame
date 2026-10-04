// Sichtprüfung mit echten Daten (nicht Teil der Tests): sucht einen Ort, fliegt hin, macht
// Screenshots von oben und nach dem Neigen. Erwartet einen laufenden Dev-Server (npm run dev).
//
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshot-live.mjs [Ort] [Ausgabeordner]
//
// In der Cloud-Sandbox ist Chromiums eigener Weg über den Proxy sehr langsam (~4 s pro Anfrage),
// dann bleibt das Gelände grob. Externe Anfragen werden deshalb über Playwright (Node) geholt.
// Ist Overpass gesperrt, beantwortet OVERPASS_SNAPSHOT=<datei.json> (Workflow „Overpass snapshot“,
// Branch ci-snapshots) die Gebäudeabfragen mit echten, vorab geladenen OSM-Daten.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [query = 'Zugspitze', outDir = '.'] = process.argv.slice(2);
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH,
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
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

await page.goto('http://localhost:5173/');
await page.getByLabel('Datum und Uhrzeit für den Sonnenstand').fill('2026-07-15T10:00');
await page.getByTestId('provider').filter({ hasText: 'Open Data' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(3000);
await page.keyboard.press('Control+k');
await page.keyboard.type(query);
await page.getByRole('option').first().waitFor({ timeout: 15_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(40_000);
console.log('Ankunft:', await hud());
await page.screenshot({ path: `${outDir}/ankunft.png` });

// Rechte Maustaste nach oben ziehen = neigen
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(640, 360 - i * 15);
  await page.waitForTimeout(400);
}
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(25_000);
console.log('Geneigt:', await hud());
await page.screenshot({ path: `${outDir}/geneigt.png` });
await browser.close();
