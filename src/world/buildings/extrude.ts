import { ShapeUtils, Vector2 } from 'three';
import { geodeticToEcef, type LocalFrame } from '../../core/geo';
import type { GeoPoint, Vec3 } from '../../core/types';
import type { Footprint } from './overpass';

/** Wände reichen so weit unter den Fußpunkt, damit an Hängen und bei groben Kacheln keine Lücke bleibt. */
export const WALL_SINK_M = 1.5;

/** Bereich eines Gebäudes in den gemeinsamen Puffern (für Collider, Ausblenden, Zerstörung). */
export interface BuildingRange {
  id: number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  /** Fußpunkt (Ellipsoidhöhe in m) und Oberkante darüber. */
  base: number;
  height: number;
}

/** Geometrie aller Gebäude einer Zelle im lokalen Frame der Zelle (x = Ost, y = Oben, z = −Nord). */
export interface CellGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  /** RGB 0..255 */
  colors: Uint8Array;
  /** Fassadenkoordinaten in m: u entlang der Wand, v Höhe über dem Fußpunkt; Dach (−1, −1). */
  uvs: Float32Array;
  indices: Uint32Array;
  buildings: BuildingRange[];
}

const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _ecef: Vec3 = { x: 0, y: 0, z: 0 };
const _local: Vec3 = { x: 0, y: 0, z: 0 };

class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(p: Vec3, nx: number, ny: number, nz: number, rgb: number, u: number, v: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(nx, ny, nz);
    this.col.push((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
    this.uv.push(u, v);
    return this.vertexCount - 1;
  }
}

/** Lokale Position eines Punkts (lon, lat) auf Höhe h im Frame. */
function toLocal(frame: LocalFrame, lon: number, lat: number, h: number, out: Vec3): Vec3 {
  _geo.lat = lat;
  _geo.lon = lon;
  _geo.height = h;
  const l = frame.ecefToLocal(geodeticToEcef(_geo, _ecef), _local);
  out.x = l.x;
  out.y = l.y;
  out.z = l.z;
  return out;
}

/** Leicht abgedunkelte Farbe (Wände unten, Schattierung). */
function shade(rgb: number, k: number): number {
  const r = Math.min(255, Math.round(((rgb >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((rgb >> 8) & 255) * k));
  const b = Math.min(255, Math.round((rgb & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/**
 * Extrudiert Gebäude-Grundrisse zu einem gemeinsamen Mesh (Spec 5.4): Wände als Quads mit
 * flachen Normalen, flaches Dach (SIMPLIFIED: keine Dachformen), Unterseite nur bei schwebenden
 * Teilen. `baseOf` liefert den Fußpunkt (Ellipsoidhöhe, niedrigster Punkt des Grundrisses).
 * Die Erdkrümmung steckt in der Umrechnung jedes Eckpunkts.
 */
export function extrudeFootprints(
  footprints: readonly Footprint[],
  frame: LocalFrame,
  baseOf: (f: Footprint) => number,
): CellGeometryData {
  const b = new Builder();
  const buildings: BuildingRange[] = [];
  const pb: Vec3 = { x: 0, y: 0, z: 0 };
  const pt: Vec3 = { x: 0, y: 0, z: 0 };
  const qb: Vec3 = { x: 0, y: 0, z: 0 };
  const qt: Vec3 = { x: 0, y: 0, z: 0 };
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };

  for (const f of footprints) {
    const base = baseOf(f);
    const top = base + f.height;
    const bottom = f.minHeight > 0 ? base + f.minHeight : base - WALL_SINK_M;
    const vBottom = bottom - base;
    const vertexStart = b.vertexCount;
    const indexStart = b.idx.length;

    for (const poly of f.polygons) {
      const rings = [poly.outer, ...poly.holes];
      // Wände
      for (const ring of rings) {
        const n = ring.length / 2;
        let u = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          toLocal(frame, ring[i * 2]!, ring[i * 2 + 1]!, bottom, pb);
          toLocal(frame, ring[i * 2]!, ring[i * 2 + 1]!, top, pt);
          toLocal(frame, ring[j * 2]!, ring[j * 2 + 1]!, bottom, qb);
          toLocal(frame, ring[j * 2]!, ring[j * 2 + 1]!, top, qt);
          const dx = qb.x - pb.x;
          const dz = qb.z - pb.z;
          const len = Math.hypot(dx, dz);
          if (len < 1e-3) continue;
          // Außenring CCW (Plan Ost/Nord), Löcher CW → außen liegt rechts der Kante, in
          // three-Achsen (z = −Nord) also (−dz, 0, dx) / len.
          const nx = -dz / len;
          const nz = dx / len;
          const wall = f.wallColour;
          const dark = shade(wall, 0.82);
          const a = b.vertex(pb, nx, 0, nz, dark, u, vBottom);
          const c = b.vertex(qb, nx, 0, nz, dark, u + len, vBottom);
          const d = b.vertex(qt, nx, 0, nz, wall, u + len, f.height);
          const e = b.vertex(pt, nx, 0, nz, wall, u, f.height);
          // Wicklung passend zur Normalen wählen
          const ux = qb.x - pb.x;
          const uz = qb.z - pb.z;
          const vy = pt.y - pb.y;
          // Normale von (a, c, d): (q−p) × (t−p) ≈ (ux,0,uz) × (0,vy,0) = (−uz·vy, 0, ux·vy)
          const fx = -uz * vy;
          const fz = ux * vy;
          if (fx * nx + fz * nz >= 0) b.idx.push(a, c, d, a, d, e);
          else b.idx.push(a, d, c, a, e, d);
          u += len;
        }
      }

      // Dach (und Unterseite bei schwebenden Teilen)
      const contour: Vector2[] = [];
      const holes: Vector2[][] = [];
      const flat: Vec3[] = [];
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r]!;
        const pts: Vector2[] = [];
        for (let i = 0; i < ring.length; i += 2) {
          toLocal(frame, ring[i]!, ring[i + 1]!, top, tmp);
          flat.push({ x: tmp.x, y: tmp.y, z: tmp.z });
          pts.push(new Vector2(tmp.x, -tmp.z));
        }
        if (r === 0) contour.push(...pts);
        else holes.push(pts);
      }
      const tris = ShapeUtils.triangulateShape(contour, holes);
      if (tris.length === 0) continue;
      const roof = f.roofColour;
      const first = b.vertexCount;
      for (const p of flat) b.vertex(p, 0, 1, 0, roof, -1, -1);
      for (const tri of tris) {
        const [i0, i1, i2] = tri as [number, number, number];
        const p0 = flat[i0]!;
        const p1 = flat[i1]!;
        const p2 = flat[i2]!;
        // y-Komponente von (p1−p0) × (p2−p0) > 0 heißt: Dreieck zeigt nach oben
        const ny = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
        if (ny >= 0) b.idx.push(first + i0, first + i1, first + i2);
        else b.idx.push(first + i0, first + i2, first + i1);
      }
      if (f.minHeight > 0) {
        const under = b.vertexCount;
        const dy = bottom - top;
        for (const p of flat)
          b.vertex({ x: p.x, y: p.y + dy, z: p.z }, 0, -1, 0, shade(f.wallColour, 0.6), -1, -1);
        for (const tri of tris) {
          const [i0, i1, i2] = tri as [number, number, number];
          const p0 = flat[i0]!;
          const p1 = flat[i1]!;
          const p2 = flat[i2]!;
          const ny = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
          if (ny >= 0) b.idx.push(under + i0, under + i2, under + i1);
          else b.idx.push(under + i0, under + i1, under + i2);
        }
      }
    }
    const vertexCount = b.vertexCount - vertexStart;
    if (vertexCount === 0) continue;
    buildings.push({
      id: f.id,
      vertexStart,
      vertexCount,
      indexStart,
      indexCount: b.idx.length - indexStart,
      base,
      height: f.height,
    });
  }

  return {
    positions: new Float32Array(b.pos),
    normals: new Float32Array(b.nor),
    colors: new Uint8Array(b.col),
    uvs: new Float32Array(b.uv),
    indices: new Uint32Array(b.idx),
    buildings,
  };
}
