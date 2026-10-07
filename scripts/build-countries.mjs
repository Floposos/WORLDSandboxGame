// Erzeugt public/data/countries.json aus Natural Earth 1:10 Mio. (gemeinfrei, ADR-026).
//
//   node scripts/build-countries.mjs [ordner-mit-geojson]
//
// Ohne Ordner werden die GeoJSON-Dateien der festen Version von GitHub geladen.
// Format (alle Koordinaten als ganze Zahlen in 1/10 000 Grad, je Ring/Linie delta-kodiert:
// [lon0, lat0, dlon1, dlat1, …]):
//   { version, source, scale, countries: [{ id, iso2, de, en, color, pop, label, bbox, rings }],
//     borders: [linie, …] }
// `rings` sind die Außen- und Innenringe aller Teilflächen (gerade-ungerade-Regel genügt),
// `borders` die Landgrenzen zwischen Staaten.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NE_VERSION = 'v5.1.2';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_VERSION}/geojson/`;
const SCALE = 1e4;
/** Vereinfachung (Douglas-Peucker) in Grad: ≈ 500 m, die Grenzen bleiben kilometergenau. */
const TOLERANCE_DEG = 0.005;

const dir = process.argv[2];
async function load(name) {
  if (dir) return JSON.parse(readFileSync(`${dir}/${name}.geojson`, 'utf8'));
  const res = await fetch(BASE + name + '.geojson');
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = pts[i0];
    const [bx, by] = pts[i1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = pts[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function encode(pts) {
  const out = [];
  let px = 0;
  let py = 0;
  for (const [lon, lat] of pts) {
    const x = Math.round(lon * SCALE);
    const y = Math.round(lat * SCALE);
    if (out.length && x === px && y === py) continue;
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

const polygonsOf = (g) =>
  g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
const linesOf = (g) =>
  g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];

const countriesGeo = await load('ne_10m_admin_0_countries');
const bordersGeo = await load('ne_10m_admin_0_boundary_lines_land');

let points = 0;
const countries = [];
const ids = new Set();
for (const f of countriesGeo.features) {
  const p = f.properties;
  let id = p.ADM0_A3;
  if (ids.has(id)) id = `${id}_${p.NE_ID}`;
  ids.add(id);
  const rings = [];
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const poly of polygonsOf(f.geometry)) {
    for (const ring of poly) {
      // Kleine Ringe nicht unter 4 Punkte vereinfachen, sonst verschwinden Inseln
      const simple = simplify(ring, TOLERANCE_DEG);
      if (simple.length < 4) continue;
      for (const [lon, lat] of simple) {
        w = Math.min(w, lon);
        e = Math.max(e, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
      }
      points += simple.length;
      rings.push(encode(simple));
    }
  }
  if (!rings.length) continue;
  const r = (v) => Math.round(v * 1000) / 1000;
  countries.push({
    id,
    iso2: p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : null,
    de: p.NAME_DE || p.NAME,
    en: p.NAME_EN || p.NAME,
    color: p.MAPCOLOR9 ?? 1,
    pop: p.POP_EST ?? 0,
    label: [r(p.LABEL_X), r(p.LABEL_Y)],
    bbox: [r(w), r(s), r(e), r(n)],
    rings,
  });
}
countries.sort((a, b) => a.id.localeCompare(b.id));

let borderPoints = 0;
const borders = [];
for (const f of bordersGeo.features) {
  for (const line of linesOf(f.geometry)) {
    const simple = simplify(line, TOLERANCE_DEG / 2);
    if (simple.length < 2) continue;
    borderPoints += simple.length;
    borders.push(encode(simple));
  }
}

mkdirSync('public/data', { recursive: true });
const json = JSON.stringify({
  version: NE_VERSION,
  source: 'Natural Earth 1:10m Admin 0 – Countries, Boundary Lines (public domain)',
  scale: SCALE,
  countries,
  borders,
});
writeFileSync('public/data/countries.json', json);
console.log(
  `${countries.length} Länder, ${points} Punkte; ${borders.length} Grenzlinien, ${borderPoints} Punkte; ${(json.length / 1e6).toFixed(2)} MB`,
);
