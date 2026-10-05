import { ShapeUtils, Vector2 } from 'three';
import { FACADE_FLOOR_M } from '../world/buildings/material';

/**
 * Vorab-Bruch eines Gebäude-Proxys (Spec 7.2, Schritt 4), rein und testbar: Der Grundriss wird
 * trianguliert, fein unterteilt und pro Stockwerk per 2D-Voronoi (Zuordnung jedes kleinen
 * Dreiecks zum nächsten Saatpunkt) in 4 bis 12 Zellen zerlegt. Alle Stockwerke teilen dieselben
 * kleinen Dreiecke; so ist die Überlappung zweier Bruchstücke übereinander exakt die Zahl
 * gemeinsamer Dreiecke (Grundlage des Strukturtests). Löcher (Innenhöfe) bleiben frei.
 *
 * Koordinaten: Plan (x = Ost, n = Nord) in m, Höhen y in m, alles im Frame der Blase.
 */

export interface FootprintPlan {
  /** Außenring x/n abwechselnd (Orientierung egal). */
  outer: number[];
  holes: number[][];
}

export interface FractureOptions {
  /** Unterkante und Oberkante (Frame-y) des Gebäudes. */
  bottom: number;
  top: number;
  /** Zellen pro Stockwerk (wird auf 4…12 begrenzt), sonst aus der Fläche. */
  cells?: number;
  /** Höchstens so viele Stockwerk-Schichten (hohe Häuser fassen Geschosse zusammen). */
  maxLayers?: number;
  /** Zufall 0…1 (deterministisch über den PRNG der Welt). */
  random: () => number;
}

export interface Fragment {
  layer: number;
  yBottom: number;
  yTop: number;
  /** Indizes in {@link FractureResult.triangles} (je 6 Zahlen x/n pro Dreieck). */
  tris: number[];
  /** Planfläche in m². */
  area: number;
  /** Mittelpunkt (x, y, n) – Plan-Schwerpunkt auf halber Schichthöhe. */
  cx: number;
  cy: number;
  cn: number;
  /** Bruchstücke der Schicht darunter mit Überlappung (Index → gemeinsame Dreiecke). */
  supports: Map<number, number>;
}

export interface FractureResult {
  /** Kleine Dreiecke, je x0 n0 x1 n1 x2 n2. */
  triangles: Float32Array;
  /** Fläche je kleinem Dreieck. */
  triArea: Float32Array;
  fragments: Fragment[];
  layers: number;
}

/** Zellen je Stockwerk aus der Grundfläche (Spec 7.2: 4…12, abhängig von Größe und Preset). */
export function cellsForArea(areaM2: number, presetScale = 1): number {
  return Math.max(4, Math.min(12, Math.round((areaM2 / 60) * presetScale)));
}

function triArea2(ax: number, an: number, bx: number, bn: number, cx: number, cn: number): number {
  return Math.abs((bx - ax) * (cn - an) - (cx - ax) * (bn - an)) / 2;
}

/** Dreiecke so lange halbieren (längste Kante), bis keine Kante länger als `maxEdge` ist. */
export function subdivide(tris: number[], maxEdge: number, maxTris = 6000): number[] {
  const out: number[] = [];
  const stack = tris.slice();
  const max2 = maxEdge * maxEdge;
  while (stack.length > 0) {
    const t = stack.splice(stack.length - 6, 6);
    const [ax, an, bx, bn, cx, cn] = t as [number, number, number, number, number, number];
    const ab = (bx - ax) ** 2 + (bn - an) ** 2;
    const bc = (cx - bx) ** 2 + (cn - bn) ** 2;
    const ca = (ax - cx) ** 2 + (an - cn) ** 2;
    const longest = Math.max(ab, bc, ca);
    if (longest <= max2 || out.length / 6 + stack.length / 6 >= maxTris) {
      out.push(...t);
      continue;
    }
    if (longest === ab) {
      const mx = (ax + bx) / 2;
      const mn = (an + bn) / 2;
      stack.push(ax, an, mx, mn, cx, cn, mx, mn, bx, bn, cx, cn);
    } else if (longest === bc) {
      const mx = (bx + cx) / 2;
      const mn = (bn + cn) / 2;
      stack.push(ax, an, bx, bn, mx, mn, ax, an, mx, mn, cx, cn);
    } else {
      const mx = (cx + ax) / 2;
      const mn = (cn + an) / 2;
      stack.push(ax, an, bx, bn, mx, mn, mx, mn, bx, bn, cx, cn);
    }
  }
  return out;
}

/** Grundriss mit Löchern triangulieren (x/n-Dreiecke). */
export function triangulatePlan(plan: FootprintPlan): number[] {
  const toV = (ring: number[]): Vector2[] => {
    const v: Vector2[] = [];
    for (let i = 0; i < ring.length; i += 2) v.push(new Vector2(ring[i], ring[i + 1]));
    return v;
  };
  const contour = toV(plan.outer);
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  const holes = plan.holes.map((h) => {
    const v = toV(h);
    if (!ShapeUtils.isClockWise(v)) v.reverse();
    return v;
  });
  const faces = ShapeUtils.triangulateShape(contour, holes);
  const all = [...contour, ...holes.flat()];
  const out: number[] = [];
  for (const f of faces) {
    for (const k of f) out.push(all[k]!.x, all[k]!.y);
  }
  return out;
}

/** Bricht einen Grundriss in Schichten und Voronoi-Zellen (siehe Modulbeschreibung). */
export function fractureFootprint(plan: FootprintPlan, opts: FractureOptions): FractureResult {
  const base = triangulatePlan(plan);
  let area = 0;
  for (let i = 0; i < base.length; i += 6) {
    area += triArea2(
      base[i]!,
      base[i + 1]!,
      base[i + 2]!,
      base[i + 3]!,
      base[i + 4]!,
      base[i + 5]!,
    );
  }
  const cells = Math.max(4, Math.min(12, opts.cells ?? cellsForArea(area)));
  // Kantenlänge so, dass jede Zelle aus etwa 12 kleinen Dreiecken besteht
  const maxEdge = Math.max(0.8, Math.sqrt((area / cells / 12) * 2));
  const flat = subdivide(base, maxEdge);
  const nTri = flat.length / 6;
  const triangles = new Float32Array(flat);
  const triArea = new Float32Array(nTri);
  const tcx = new Float32Array(nTri);
  const tcn = new Float32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const o = t * 6;
    triArea[t] = triArea2(
      flat[o]!,
      flat[o + 1]!,
      flat[o + 2]!,
      flat[o + 3]!,
      flat[o + 4]!,
      flat[o + 5]!,
    );
    tcx[t] = (flat[o]! + flat[o + 2]! + flat[o + 4]!) / 3;
    tcn[t] = (flat[o + 1]! + flat[o + 3]! + flat[o + 5]!) / 3;
  }

  const height = Math.max(0.5, opts.top - opts.bottom);
  const maxLayers = Math.max(1, opts.maxLayers ?? 12);
  const layers = Math.max(1, Math.min(maxLayers, Math.round(height / FACADE_FLOOR_M)));
  const layerH = height / layers;

  const fragments: Fragment[] = [];
  let prevOwner: Int32Array | null = null;
  for (let layer = 0; layer < layers; layer++) {
    // Saatpunkte: Schwerpunkte zufälliger kleiner Dreiecke (liegen sicher im Grundriss)
    const k = Math.min(cells, nTri);
    const seeds: number[] = [];
    const used = new Set<number>();
    for (let s = 0; s < k * 8 && seeds.length < k * 2; s++) {
      const t = Math.floor(opts.random() * nTri);
      if (used.has(t)) continue;
      used.add(t);
      seeds.push(tcx[t]!, tcn[t]!);
    }
    const nSeeds = seeds.length / 2;
    const owner = new Int32Array(nTri);
    const lists: number[][] = Array.from({ length: nSeeds }, () => []);
    for (let t = 0; t < nTri; t++) {
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s < nSeeds; s++) {
        const d = (tcx[t]! - seeds[s * 2]!) ** 2 + (tcn[t]! - seeds[s * 2 + 1]!) ** 2;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      lists[best]!.push(t);
      owner[t] = best;
    }
    const yBottom = opts.bottom + layer * layerH;
    const yTop = yBottom + layerH;
    const remap = new Int32Array(nSeeds).fill(-1);
    for (let s = 0; s < nSeeds; s++) {
      const tris = lists[s]!;
      if (tris.length === 0) continue;
      let a = 0;
      let mx = 0;
      let mn = 0;
      for (const t of tris) {
        a += triArea[t]!;
        mx += tcx[t]! * triArea[t]!;
        mn += tcn[t]! * triArea[t]!;
      }
      remap[s] = fragments.length;
      fragments.push({
        layer,
        yBottom,
        yTop,
        tris,
        area: a,
        cx: mx / a,
        cy: (yBottom + yTop) / 2,
        cn: mn / a,
        supports: new Map(),
      });
    }
    for (let t = 0; t < nTri; t++) owner[t] = remap[owner[t]!]!;
    if (prevOwner) {
      for (let t = 0; t < nTri; t++) {
        const f = fragments[owner[t]!]!;
        const below = prevOwner[t]!;
        f.supports.set(below, (f.supports.get(below) ?? 0) + 1);
      }
    }
    prevOwner = owner;
  }
  return { triangles, triArea, fragments, layers };
}

/**
 * Strukturtest (Spec 7.2, Schritt 5): Ein Bruchstück steht, solange die noch festen Stücke
 * darunter mindestens `minShare` seiner Dreiecke tragen. Die unterste Schicht steht auf dem Boden.
 */
export function isSupported(
  f: Fragment,
  fixed: (index: number) => boolean,
  minShare = 0.35,
): boolean {
  if (f.layer === 0) return true;
  let carried = 0;
  for (const [i, n] of f.supports) if (fixed(i)) carried += n;
  return carried >= f.tris.length * minShare;
}
