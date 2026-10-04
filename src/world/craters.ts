import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
} from 'three';
import { ecefToGeodetic, geodeticToEcef, LocalFrame } from '../core/geo';
import type { GeoPoint, Vec3 } from '../core/types';
import { craterOffset, type CraterSize } from '../physics/blast';
import type { HeightPatches } from './heightPatches';
import type { TileMask } from './tileMask';

/** Ringe und Segmente des Krater-Meshes. */
const RINGS = 20;
const SEGMENTS = 40;
/** Das Mesh reicht bis 2 · R (Ende des Walls). */
const OUTER = 2;
/** Ab hier blendet die Erdfarbe zum Gelände aus (Vielfaches von R). */
const FADE_FROM = 1.25;

const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _ecef: Vec3 = { x: 0, y: 0, z: 0 };
const _loc: Vec3 = { x: 0, y: 0, z: 0 };

export interface CraterServiceOptions {
  globe: Object3D;
  patches: HeightPatches;
  mask: TileMask;
  /** Geländehöhe ohne Krater an lat/lon (Ellipsoid) oder null. */
  rawHeight: (lat: number, lon: number) => number | null;
  /** Sichtbare Bodenhöhe (Mesh-Raycast, z. B. Fotogrammetrie) für den Rand, oder null. */
  visibleHeight?: (lat: number, lon: number) => number | null;
}

interface CraterVisual {
  id: number;
  group: Group;
  maskId: number;
}

/**
 * Krater (Spec 7.4): Höhen-Patch für Sampler, Boden und Heightfield, dazu ein eigenes Mesh.
 * SIMPLIFIED (ADR-022): Auch im Open-Data-Modus wird das Tile-Mesh in der Schüssel maskiert
 * und durch das Krater-Mesh ersetzt, statt den Gelände-Shader zu verformen. Der Wall liegt über
 * dem Gelände und verdeckt es ohne Maske; seine Erdfarbe blendet nach außen aus.
 */
export class CraterService {
  private readonly visuals: CraterVisual[] = [];
  private readonly material = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: true,
  });

  constructor(private readonly opts: CraterServiceOptions) {
    // Älteste Krater fallen mit den Patches weg (MAX_CRATERS)
    opts.patches.onChange(() => this.prune());
  }

  get count(): number {
    return this.visuals.length;
  }

  /** Krater an `center` (Bodenpunkt) anlegen. Liefert die Patch-ID oder null (zu klein). */
  add(center: GeoPoint, size: CraterSize): number | null {
    if (size.radiusM < 0.3) return null;
    const frame = new LocalFrame({ lat: center.lat, lon: center.lon, height: 0 });
    // Sichtbare Randhöhen vor dem Maskieren bestimmen (später träfe der Raycast die Maske)
    const outerR = OUTER * size.radiusM;
    const edge = new Float32Array(SEGMENTS);
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const g = this.geoAt(frame, Math.cos(a) * outerR, -Math.sin(a) * outerR);
      const raw = this.opts.rawHeight(g.lat, g.lon) ?? center.height;
      const vis = this.opts.visibleHeight?.(g.lat, g.lon) ?? null;
      edge[s] = vis !== null && Math.abs(vis - raw) < 30 ? vis - raw : 0;
    }
    const patch = this.opts.patches.add(center.lat, center.lon, size);
    if (!patch) return null;

    const geometry = this.buildGeometry(frame, center, size, edge);
    const mesh = new Mesh(geometry, this.material);
    mesh.name = 'crater';
    mesh.renderOrder = 1;
    const group = new Group();
    group.matrixAutoUpdate = false;
    group.matrix.fromArray(frame.ecefToLocalMatrix()).invert();
    group.add(mesh);
    this.opts.globe.add(group);
    group.updateMatrixWorld(true);
    // Die Schüssel liegt unter dem Gelände: dort das Tile-Mesh ausblenden
    const maskId = this.opts.mask.addCircle(center, size.radiusM * 1.02);
    this.visuals.push({ id: patch.id, group, maskId });
    return patch.id;
  }

  private geoAt(frame: LocalFrame, x: number, z: number): GeoPoint {
    _loc.x = x;
    _loc.y = 0;
    _loc.z = z;
    return ecefToGeodetic(frame.localToEcef(_loc, _ecef), _geo);
  }

  private buildGeometry(
    frame: LocalFrame,
    center: GeoPoint,
    size: CraterSize,
    edge: Float32Array,
  ): BufferGeometry {
    const verts = (RINGS + 1) * SEGMENTS;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 4);
    const outerR = OUTER * size.radiusM;
    for (let r = 0; r <= RINGS; r++) {
      // Dichter in der Mitte, damit die Schüssel rund wirkt
      const t = r / RINGS;
      const rad = outerR * t ** 1.15;
      const x01 = rad / size.radiusM;
      for (let s = 0; s < SEGMENTS; s++) {
        const a = (s / SEGMENTS) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = -Math.sin(a) * rad;
        const g = this.geoAt(frame, x, z);
        const lat = g.lat;
        const lon = g.lon;
        const raw = this.opts.rawHeight(lat, lon) ?? center.height;
        // Alle Krater (auch ältere) sind im Patch enthalten; Randanpassung an das sichtbare Mesh
        const h = raw + this.opts.patches.offsetAt(lat, lon) + edge[s]! * t ** 2;
        _geo.lat = lat;
        _geo.lon = lon;
        _geo.height = h;
        const l = frame.ecefToLocal(geodeticToEcef(_geo, _ecef), _loc);
        const i = r * SEGMENTS + s;
        pos[i * 3] = l.x;
        pos[i * 3 + 1] = l.y;
        pos[i * 3 + 2] = l.z;
        // Erdfarbe: dunkel verbrannt in der Mitte, heller am Wall, außen ausblenden
        const off = craterOffset(rad, size);
        const k = Math.min(1, Math.max(0, (off + size.depthM) / Math.max(0.01, size.depthM)));
        col[i * 4] = 0.13 + 0.12 * k;
        col[i * 4 + 1] = 0.1 + 0.09 * k;
        col[i * 4 + 2] = 0.08 + 0.06 * k;
        col[i * 4 + 3] =
          x01 <= FADE_FROM ? 1 : Math.max(0, 1 - (x01 - FADE_FROM) / (OUTER - FADE_FROM));
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < RINGS; r++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const a = r * SEGMENTS + s;
        const b = r * SEGMENTS + ((s + 1) % SEGMENTS);
        const c = (r + 1) * SEGMENTS + s;
        const d = (r + 1) * SEGMENTS + ((s + 1) % SEGMENTS);
        // Gegen den Uhrzeigersinn von oben (Normale nach +y)
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  /** Visuals entfernen, deren Patch weggefallen ist. */
  private prune(): void {
    const alive = new Set(this.opts.patches.craters.map((c) => c.id));
    for (let i = this.visuals.length - 1; i >= 0; i--) {
      const v = this.visuals[i]!;
      if (alive.has(v.id)) continue;
      this.disposeVisual(v);
      this.visuals.splice(i, 1);
    }
  }

  private disposeVisual(v: CraterVisual): void {
    v.group.removeFromParent();
    (v.group.children[0] as Mesh).geometry.dispose();
    this.opts.mask.remove(v.maskId);
  }

  /** Alle Krater entfernen („Blase zurücksetzen“). */
  clear(): void {
    this.opts.patches.clear();
  }

  /** Krater-Meshes für Raycasts (die Maske verdeckt das Tile-Mesh darunter). */
  get meshes(): Object3D[] {
    return this.visuals.map((v) => v.group.children[0]!);
  }

  dispose(): void {
    for (const v of this.visuals) this.disposeVisual(v);
    this.visuals.length = 0;
    this.material.dispose();
  }
}
