import type { Vector3 } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Raycaster,
  SRGBColorSpace,
  Color,
  type Intersection,
  type Object3D,
  type Ray,
} from 'three';
import { haversineDistance, LocalFrame } from '../../core/geo';
import { isAbortError } from '../../core/net';
import type { AttributionEntry, GeoPoint } from '../../core/types';
import type { HeightSampler } from '../heightSampler';
import { BuildingCache } from './cache';
import { extrudeFootprints, type CellGeometryData } from './extrude';
import { cellsCovering, geohashBounds, geohashEncode, unionBounds } from './geohash';
import { createBuildingMaterial } from './material';
import { OverpassClient, type Footprint } from './overpass';

/** Präzision der Cache-Zellen (Spec 5.4): Geohash 6 ≈ 1,2 km × 0,6 km. */
export const CELL_PRECISION = 6;
/** Höchstens so viele Zellen pro Overpass-Anfrage (Antwortgröße, Timeout). */
export const MAX_CELLS_PER_REQUEST = 4;
/** Höchstens so viele Zellen gleichzeitig im Speicher (LRU nach Entfernung). */
export const MAX_LOADED_CELLS = 120;
/** Höchstens so viele Zellen wünscht ein Ladekreis (Rest für den Rand beim Weiterschwenken). */
export const MAX_WANTED_CELLS = 100;

/**
 * Zellen im Ladekreis. Geohash-Zellen werden nach Norden schmaler: Wünscht der Kreis mehr
 * Zellen als {@link MAX_WANTED_CELLS}, wird der Radius gekappt (sonst wirft `evict` Randzellen
 * ab und sie werden laufend neu gebaut, Befund Test 2026-10-06 in Oslo).
 */
export function wantedCells(
  focus: GeoPoint,
  radiusM: number,
): { cells: string[]; radiusM: number } {
  let cells = cellsCovering(focus.lat, focus.lon, radiusM, CELL_PRECISION);
  while (cells.length > MAX_WANTED_CELLS && radiusM > 500) {
    radiusM *= Math.sqrt(MAX_WANTED_CELLS / cells.length) * 0.97;
    cells = cellsCovering(focus.lat, focus.lon, radiusM, CELL_PRECISION);
  }
  return { cells, radiusM };
}
/** Nach einem Fehler wird eine Zelle frühestens so spät erneut versucht. */
export const RETRY_AFTER_MS = 30_000;

export const OSM_ATTRIBUTION: AttributionEntry = {
  id: 'osm-buildings',
  text: '© OpenStreetMap-Mitwirkende (Gebäude)',
  url: 'https://www.openstreetmap.org/copyright',
  license: 'ODbL 1.0',
};

/** Eine geladene Zelle mit ihrem Mesh im lokalen Frame der Zellmitte. */
export interface BuildingCell {
  hash: string;
  /** Frame der Zellmitte (Höhe 0); Mesh-Koordinaten sind in diesem Frame. */
  frame: LocalFrame;
  /** Zell-Frame → ECEF. */
  toEcef: Matrix4;
  mesh: Mesh<BufferGeometry>;
  data: CellGeometryData;
  footprints: readonly Footprint[];
}

export interface BuildingHit {
  point: Vector3;
  normal: Vector3 | null;
  distance: number;
  buildingId: number;
  cell: BuildingCell;
}

export interface BuildingServiceOptions {
  /** Gruppe im ECEF-Frame (Globus); die Zellen hängen darin. */
  globe: Object3D;
  sampler: HeightSampler;
  client?: OverpassClient;
  cache?: BuildingCache;
  /** Versatz Mesh-Höhe − Terrarium-Höhe (Geoid bei Google/Cesium), sonst 0. */
  heightOffset?: (lat: number, lon: number) => number;
  onError?: (error: unknown) => void;
}

type CellListener = (cell: BuildingCell) => void;

const _color = new Color();
const _raycaster = new Raycaster();

/** sRGB-Bytes → lineare Float-Farben (three rechnet Vertexfarben linear). */
function linearColors(srgb: Uint8Array): Float32Array {
  const out = new Float32Array(srgb.length);
  for (let i = 0; i < srgb.length; i += 3) {
    _color.setRGB(srgb[i]! / 255, srgb[i + 1]! / 255, srgb[i + 2]! / 255, SRGBColorSpace);
    out[i] = _color.r;
    out[i + 1] = _color.g;
    out[i + 2] = _color.b;
  }
  return out;
}

/**
 * Lädt OSM-Gebäude zellenweise um einen Fokuspunkt (Spec 5.4), extrudiert sie und hängt die
 * Meshes in den Globus. Open Data: sichtbar. Google/Cesium: unsichtbar, nur für Collider (Spec M3).
 */
export class BuildingService {
  readonly group = new Group();
  readonly material = createBuildingMaterial();
  private readonly cells = new Map<string, BuildingCell>();
  private readonly pending = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private readonly added = new Set<CellListener>();
  private readonly removed = new Set<CellListener>();
  private readonly client: OverpassClient;
  private readonly cache: BuildingCache;
  private readonly abort = new AbortController();
  private queue: string[] = [];
  private fetching = false;
  private visibleValue = true;
  private focus: GeoPoint = { lat: 0, lon: 0, height: 0 };
  private radius = 600;
  private disposed = false;

  constructor(private readonly opts: BuildingServiceOptions) {
    this.client = opts.client ?? new OverpassClient();
    this.cache = opts.cache ?? new BuildingCache();
    this.group.name = 'buildings';
    opts.globe.add(this.group);
  }

  onCellAdded(fn: CellListener): () => void {
    this.added.add(fn);
    return () => this.added.delete(fn);
  }

  onCellRemoved(fn: CellListener): () => void {
    this.removed.add(fn);
    return () => this.removed.delete(fn);
  }

  get loadedCells(): readonly BuildingCell[] {
    return [...this.cells.values()];
  }

  get buildingCount(): number {
    let n = 0;
    for (const c of this.cells.values()) n += c.data.buildings.length;
    return n;
  }

  /** Lädt gerade (für Tests, HUD). */
  get busy(): boolean {
    return this.fetching || this.pending.size > 0;
  }

  get visible(): boolean {
    return this.visibleValue;
  }

  /** Sichtbar (Open Data) oder nur Collider (Fotogrammetrie mit Gebäuden im Mesh). */
  setVisible(v: boolean): void {
    this.visibleValue = v;
    for (const c of this.cells.values()) c.mesh.visible = v;
  }

  attributions(): AttributionEntry[] {
    return this.cells.size > 0 ? [OSM_ATTRIBUTION] : [];
  }

  /**
   * Fordert die Zellen im Radius um `focus` an (nächste zuerst) und gibt weit entfernte frei.
   * Gedrosselt aufrufen (z. B. 1 Hz).
   */
  update(focus: GeoPoint, radiusM: number): void {
    if (this.disposed) return;
    this.focus = { ...focus };
    const { cells: wanted, radiusM: capped } = wantedCells(focus, radiusM);
    this.radius = capped;
    const now = Date.now();
    const fresh = wanted.filter(
      (h) =>
        !this.cells.has(h) &&
        !this.pending.has(h) &&
        now - (this.failedAt.get(h) ?? -Infinity) > RETRY_AFTER_MS,
    );
    // Neue Wünsche vorn, veraltete Wünsche (weit weg) verwerfen
    for (const h of this.queue) if (!wanted.includes(h)) this.pending.delete(h);
    this.queue = [...fresh, ...this.queue.filter((h) => wanted.includes(h))];
    for (const h of fresh) this.pending.add(h);
    this.evict();
    void this.pump();
  }

  private evict(): void {
    const keepM = this.radius * 2.5 + 1_500;
    const byDistance = [...this.cells.values()]
      .map((c) => ({ c, d: haversineDistance(c.frame.origin, this.focus) }))
      .sort((a, b) => a.d - b.d);
    byDistance.forEach(({ c, d }, i) => {
      if (d > keepM || i >= MAX_LOADED_CELLS) this.removeCell(c.hash);
    });
  }

  private async pump(): Promise<void> {
    if (this.fetching) return;
    this.fetching = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        // Zuerst aus dem Cache
        const batch: string[] = [];
        while (this.queue.length > 0 && batch.length < MAX_CELLS_PER_REQUEST) {
          const h = this.queue.shift()!;
          const cached = await this.cache.get(h);
          if (cached) await this.build(h, cached);
          else batch.push(h);
        }
        if (batch.length === 0) continue;
        try {
          const list = await this.client.fetchBuildings(unionBounds(batch), this.abort.signal);
          const byCell = new Map<string, Footprint[]>(batch.map((h) => [h, []]));
          for (const f of list) byCell.get(geohashEncode(f.lat, f.lon, CELL_PRECISION))?.push(f);
          for (const [h, fs] of byCell) {
            void this.cache.set(h, fs);
            await this.build(h, fs);
          }
        } catch (e) {
          if (isAbortError(e)) return;
          const t = Date.now();
          for (const h of batch) {
            this.failedAt.set(h, t);
            this.pending.delete(h);
          }
          this.opts.onError?.(e);
        }
      }
    } finally {
      this.fetching = false;
    }
  }

  /** Baut das Mesh einer Zelle (Fußpunkte aus dem HeightSampler) und hängt es ein. */
  private async build(hash: string, footprints: readonly Footprint[]): Promise<void> {
    this.pending.delete(hash);
    if (this.disposed || this.cells.has(hash)) return;
    const b = geohashBounds(hash);
    const centerLat = (b.north + b.south) / 2;
    const centerLon = (b.east + b.west) / 2;
    try {
      await this.opts.sampler.prefetch(centerLat, centerLon, 900, this.abort.signal);
    } catch (e) {
      if (isAbortError(e)) return;
      // Ohne Höhen bauen wir trotzdem (Fußpunkt aus sampleAsync bzw. 0)
    }
    const offset = this.opts.heightOffset?.(centerLat, centerLon) ?? 0;
    const bases = new Map<number, number>();
    for (const f of footprints) {
      let min = Infinity;
      const outer = f.polygons[0]!.outer;
      for (let i = 0; i < outer.length; i += 2) {
        const h = this.opts.sampler.sample(outer[i + 1]!, outer[i]!);
        if (h !== null) min = Math.min(min, h);
      }
      if (min === Infinity) {
        try {
          min = await this.opts.sampler.sampleAsync(f.lat, f.lon, this.abort.signal);
        } catch {
          min = 0;
        }
      }
      bases.set(f.id, min + offset);
    }
    if (this.disposed || this.cells.has(hash)) return;

    const frame = new LocalFrame({ lat: centerLat, lon: centerLon, height: 0 });
    const data = extrudeFootprints(footprints, frame, (f) => bases.get(f.id) ?? 0);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(linearColors(data.colors), 3));
    geometry.setAttribute('facade', new BufferAttribute(data.uvs, 2));
    // Eigene Kopie: die Zerstörung blendet Gebäude im Index aus, die Collider brauchen das Original
    geometry.setIndex(new BufferAttribute(data.indices.slice(), 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const mesh = new Mesh(geometry, this.material);
    mesh.name = `buildings-${hash}`;
    mesh.matrixAutoUpdate = false;
    const toEcef = new Matrix4().fromArray(frame.ecefToLocalMatrix()).invert();
    mesh.matrix.copy(toEcef);
    mesh.visible = this.visibleValue;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    mesh.updateMatrixWorld(true);
    const cell: BuildingCell = { hash, frame, toEcef, mesh, data, footprints };
    this.cells.set(hash, cell);
    for (const fn of this.added) fn(cell);
  }

  private removeCell(hash: string): void {
    const cell = this.cells.get(hash);
    if (!cell) return;
    this.cells.delete(hash);
    this.group.remove(cell.mesh);
    cell.mesh.geometry.dispose();
    for (const fn of this.removed) fn(cell);
  }

  /** Nächster Gebäudetreffer entlang eines Weltstrahls (auch wenn die Meshes unsichtbar sind). */
  raycast(ray: Ray, far = Infinity): BuildingHit | null {
    if (this.cells.size === 0) return null;
    _raycaster.ray.copy(ray);
    _raycaster.far = far;
    const hits: Intersection[] = [];
    for (const c of this.cells.values()) c.mesh.raycast(_raycaster, hits);
    if (hits.length === 0) return null;
    hits.sort((a, b) => a.distance - b.distance);
    const h = hits[0]!;
    const cell = [...this.cells.values()].find((c) => c.mesh === h.object)!;
    const faceIndex = h.faceIndex ?? 0;
    const tri = faceIndex * 3;
    const range = cell.data.buildings.find(
      (r) => tri >= r.indexStart && tri < r.indexStart + r.indexCount,
    );
    const normal = h.face ? h.face.normal.clone().transformDirection(cell.mesh.matrixWorld) : null;
    return {
      point: h.point.clone(),
      normal,
      distance: h.distance,
      buildingId: range?.id ?? 0,
      cell,
    };
  }

  /** Alles verwerfen und neu laden (z. B. „Blase zurücksetzen“, Provider-Wechsel). */
  reset(): void {
    for (const h of [...this.cells.keys()]) this.removeCell(h);
    this.pending.clear();
    this.queue = [];
    this.failedAt.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.reset();
    this.group.removeFromParent();
    this.material.dispose();
  }
}
