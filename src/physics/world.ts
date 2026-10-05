import type {
  Collider,
  ColliderDesc,
  EventQueue,
  ImpulseJoint,
  RigidBody,
  RigidBodyDesc,
  World,
} from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Matrix4,
  Quaternion,
  Ray,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { STANDARD_GRAVITY } from '../core/constants';
import { ecefToGeodetic, geodeticToEcef, LocalFrame } from '../core/geo';
import type { GeoPoint, Vec3 } from '../core/types';
import type { BuildingCell } from '../world/buildings/buildingService';
import {
  crossesFreeze,
  nextSleep,
  DESPAWN_FADE_S,
  outsideBubble,
  selectDespawn,
  type BudgetEntry,
} from './budget';
import { InstancedPool } from './pool';
import type { Rapier } from './rapier';
import {
  addDetail,
  buildHeightfield,
  insideHeightfield,
  sampleHeightfield,
  type HeightfieldData,
} from './terrain';

export type BodyKind =
  'box' | 'ball' | 'npc' | 'car' | 'brick' | 'wrecking-ball' | 'fragment' | 'projectile';

/** Zustand einer NPC-Kapsel (wandert, fällt bei Stößen um). */
export interface NpcState {
  heading: number;
  nextTurn: number;
  fallen: boolean;
}

/** Ein simulierter Körper mit Darstellung. */
export interface SimBody {
  readonly id: number;
  readonly kind: BodyKind;
  rb: RigidBody | null;
  readonly volume: number;
  spawnedAt: number;
  sleptS: number;
  frozen: boolean;
  /** Eingefroren und in Ruhelage gezeichnet: die Instanz bleibt statisch (Spec 7.1). */
  atRest: boolean;
  pinned: boolean;
  debris: boolean;
  /** Instanz in einem Pool, oder eigenes Objekt (Auto). */
  pool: InstancedPool | null;
  instance: number;
  object: Object3D | null;
  readonly scale: Vector3;
  readonly prevPos: Vector3;
  readonly prevQuat: Quaternion;
  readonly pos: Vector3;
  readonly quat: Quaternion;
  /** Verbleibende Ausblendzeit beim Despawn (−1 = lebt). */
  dying: number;
  npc?: NpcState;
  /** Aufräumen von Zusatzobjekten (Seil, Anker, Fahrzeugsteuerung). */
  onRemove?: () => void;
  /** Nach dem Ausblenden: eigene Geometrien/Materialien freigeben. */
  onFree?: () => void;
  /** Ein anderer Körper hat diesen getroffen (Kollisionsbeginn), z. B. Gebäude-Bruchstücke. */
  onHit?: (other: SimBody) => void;
  /** Wird nach jedem Physikschritt aufgerufen (Fahrzeuge). */
  onStep?: (dt: number) => void;
}

export interface PhysicsHit {
  /** Weltkoordinaten. */
  point: Vector3;
  normal: Vector3;
  distance: number;
  body: SimBody | null;
  buildingId: number | null;
}

export interface PhysicsWorldOptions {
  /** ECEF-Gruppe (Globus); die Blase hängt darin. */
  globe: Object3D;
  /** Geländehöhe (Ellipsoid) für das Heightfield, null = unbekannt. */
  heightAt: (lat: number, lon: number) => number | null;
  /** Lädt die Höhen für die Blase vor. */
  prefetch?: (lat: number, lon: number, radiusM: number) => Promise<void>;
  maxBodies: number;
  /** Bereiche mit feinem Gelände (Krater, Spec 7.4): Mitte und Radius bis zum Wallende. */
  terrainDetails?: () => readonly { lat: number; lon: number; radiusM: number }[];
}

/** Materialien → Dichte (kg/m³), Reibung, Rückprall. */
export const MATERIALS = {
  wood: { density: 600, friction: 0.6, restitution: 0.2, color: 0xa8794a },
  concrete: { density: 2_400, friction: 0.8, restitution: 0.05, color: 0x9d9a94 },
  metal: { density: 7_800, friction: 0.4, restitution: 0.15, color: 0x8796a3 },
  rubber: { density: 1_100, friction: 0.9, restitution: 0.75, color: 0xd2483a },
} as const;
export type MaterialId = keyof typeof MATERIALS;

/** Pool-Kapazität je Form (Ultra: 5 000 Bodies insgesamt). */
const POOL_CAPACITY = 5_000;

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _inv = new Matrix4();
const _ray = new Ray();
const _e: Vec3 = { x: 0, y: 0, z: 0 };
const _loc: Vec3 = { x: 0, y: 0, z: 0 };
const _one = new Vector3(1, 1, 1);
// Scratch-Objekte für Rapier-Abfragen im Schritt (Spec 11: keine Allokation pro Frame)
const _rt = { x: 0, y: 0, z: 0 };
const _rr = { x: 0, y: 0, z: 0, w: 1 };
const _rv = { x: 0, y: 0, z: 0 };
const _rset = { x: 0, y: 0, z: 0 };

/**
 * Rapier-Welt in der Simulationsblase (Spec 7.1, ADR-020). Die Blase hat einen eigenen
 * Tangential-Frame (Mitte auf Geländehöhe, x = Ost, y = Oben, z = −Nord); dessen Gruppe hängt im
 * Globus. So bleiben Rapier-Koordinaten klein (Float32), die Schwerkraft zeigt exakt nach −y und
 * Ursprungsverschiebungen der Kamera berühren die Physik nicht.
 */
export class PhysicsWorld {
  readonly group = new Group();
  readonly world: World;
  private readonly events: EventQueue;
  private frameValue: LocalFrame | null = null;
  private radiusValue = 0;
  private terrain: Collider | null = null;
  private heightfield: HeightfieldData | null = null;
  private readonly detailColliders: Collider[] = [];
  private readonly detailFields: HeightfieldData[] = [];
  private readonly buildingColliders = new Map<string, Collider[]>();
  /** Zerstörte Gebäude bekommen keinen statischen Collider mehr (auch nach Neuaufbau). */
  private readonly suppressed = new Set<number>();
  private readonly colliderBuilding = new Map<number, number>();
  private readonly colliderBody = new Map<number, SimBody>();
  private readonly bodies = new Map<number, SimBody>();
  private readonly dying: SimBody[] = [];
  private readonly cells = new Map<string, BuildingCell>();
  readonly pools: Record<'box' | 'ball' | 'npc', InstancedPool>;
  private nextId = 1;
  /** Simulationszeit in s. */
  time = 0;
  private building: Promise<void> | null = null;
  maxBodies: number;
  /** Schwerkraft als Vielfaches von g (Werkzeug „Gravitation“, M5). */
  gravityScale = 1;
  /** Zufall für NPCs (deterministisch über Rng in den Werkzeugen gesetzt). */
  random: () => number = Math.random;

  constructor(
    readonly R: Rapier,
    private readonly opts: PhysicsWorldOptions,
  ) {
    this.world = new R.World({ x: 0, y: -STANDARD_GRAVITY, z: 0 });
    this.events = new R.EventQueue(true);
    this.maxBodies = opts.maxBodies;
    this.group.name = 'physics-bubble';
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    opts.globe.add(this.group);
    this.pools = {
      box: new InstancedPool(new BoxGeometry(1, 1, 1), POOL_CAPACITY, 'boxes'),
      ball: new InstancedPool(new SphereGeometry(1, 20, 14), POOL_CAPACITY, 'balls'),
      npc: new InstancedPool(new CapsuleGeometry(0.25, 1.2, 4, 10), POOL_CAPACITY, 'npcs'),
    };
    for (const p of Object.values(this.pools)) this.group.add(p.mesh);
  }

  get frame(): LocalFrame | null {
    return this.frameValue;
  }

  get radius(): number {
    return this.radiusValue;
  }

  get ready(): boolean {
    return this.frameValue !== null && this.building === null;
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  get simTime(): number {
    return this.time;
  }

  allBodies(): IterableIterator<SimBody> {
    return this.bodies.values();
  }

  // ---------------------------------------------------------------- Blase

  /** Liegt der Punkt (geodätisch) innerhalb von `margin` × Radius der aktuellen Blase? */
  contains(geo: GeoPoint, margin = 0.8): boolean {
    if (!this.frameValue) return false;
    const l = this.frameValue.ecefToLocal(geodeticToEcef(geo, _e), _e);
    return Math.hypot(l.x, l.z) < this.radiusValue * margin;
  }

  /**
   * Sorgt dafür, dass die Blase den Punkt enthält. Liegt er außerhalb, wird die Blase dort neu
   * aufgebaut (Objekte der alten Blase verschwinden, Spec 7.1).
   */
  async ensureBubble(geo: GeoPoint, radiusM: number): Promise<void> {
    if (this.building) await this.building;
    if (this.contains(geo) && Math.abs(radiusM - this.radiusValue) < 1) return;
    this.building = this.rebuild(geo, radiusM).finally(() => (this.building = null));
    await this.building;
  }

  private async rebuild(center: GeoPoint, radiusM: number): Promise<void> {
    this.clearBodies();
    try {
      await this.opts.prefetch?.(center.lat, center.lon, radiusM * 1.5);
    } catch {
      // Ohne vollständige Höhen trotzdem weiter (Lücken werden aufgefüllt)
    }
    const h0 = this.opts.heightAt(center.lat, center.lon) ?? center.height;
    this.frameValue = new LocalFrame({ lat: center.lat, lon: center.lon, height: h0 });
    this.radiusValue = radiusM;
    this.group.matrix.fromArray(this.frameValue.ecefToLocalMatrix()).invert();
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateMatrixWorld(true);
    this.group.visible = true;
    this.rebuildTerrain();
    for (const key of [...this.buildingColliders.keys()]) this.removeCellColliders(key);
    for (const cell of this.cells.values()) this.addCellColliders(cell);
    this.onRebuild?.();
  }

  /** Neue Blase steht (alle Körper wurden entfernt): Zerstörung und Effekte zurücksetzen. */
  onRebuild: (() => void) | null = null;

  /** Geländehöhe (Heightfield) an (x, z) im Blasen-Frame, 0 ohne Blase. */
  groundY(x: number, z: number): number {
    for (const f of this.detailFields) {
      if (insideHeightfield(f, x, z)) return sampleHeightfield(f, x, z);
    }
    return this.heightfield ? sampleHeightfield(this.heightfield, x, z) : 0;
  }

  /** Heightfield neu erzeugen (Ursprungswechsel der Blase, später Krater). */
  rebuildTerrain(): void {
    if (!this.frameValue) return;
    if (this.terrain) this.world.removeCollider(this.terrain, false);
    for (const c of this.detailColliders) this.world.removeCollider(c, false);
    this.detailColliders.length = 0;
    this.detailFields.length = 0;
    const frame = this.frameValue;
    const hf = buildHeightfield(frame, this.radiusValue, this.opts.heightAt);
    this.heightfield = hf;
    // Krater: das grobe Raster (Mittel: 9,4 m) gibt die Schüssel nicht wieder; feine Felder darüber
    for (const d of this.opts.terrainDetails?.() ?? []) {
      const c = this.geoToBubble({ lat: d.lat, lon: d.lon, height: 0 }, _v);
      if (Math.hypot(c.x, c.z) > this.radiusValue + d.radiusM) continue;
      this.detailFields.push(addDetail(hf, frame, this.opts.heightAt, c.x, c.z, d.radiusM));
    }
    this.terrain = this.world.createCollider(this.heightfieldDesc(hf));
    for (const f of this.detailFields) {
      this.detailColliders.push(
        this.world.createCollider(this.heightfieldDesc(f).setTranslation(f.cx, 0, f.cz)),
      );
    }
  }

  private heightfieldDesc(hf: HeightfieldData): ColliderDesc {
    return this.R.ColliderDesc.heightfield(hf.n, hf.n, hf.heights, {
      x: hf.size,
      y: 1,
      z: hf.size,
    }).setFriction(0.9);
  }

  get terrainData(): HeightfieldData | null {
    return this.heightfield;
  }

  // ---------------------------------------------------------------- Gebäude

  /** Gebäudezelle bekannt machen (Collider entstehen, sobald sie in der Blase liegt). */
  addCell(cell: BuildingCell): void {
    this.cells.set(cell.hash, cell);
    if (this.frameValue && !this.building) this.addCellColliders(cell);
  }

  removeCell(cell: BuildingCell): void {
    this.cells.delete(cell.hash);
    this.removeCellColliders(cell.hash);
  }

  /** Statische Trimesh-Collider je Gebäude (Spec 7.1: statisch bis zur Zerstörung in M4). */
  private addCellColliders(cell: BuildingCell): void {
    const frame = this.frameValue;
    if (!frame || this.buildingColliders.has(cell.hash)) return;
    // Zell-Frame → Blasen-Frame (Float64 in JS)
    _m.fromArray(frame.ecefToLocalMatrix()).multiply(cell.toEcef);
    const { positions, indices, buildings } = cell.data;
    const list: Collider[] = [];
    const reach = this.radiusValue * 1.1 + 50;
    for (const b of buildings) {
      if (this.suppressed.has(b.id)) continue;
      const verts = new Float32Array(b.vertexCount * 3);
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < b.vertexCount; k++) {
        const s = (b.vertexStart + k) * 3;
        _v.set(positions[s]!, positions[s + 1]!, positions[s + 2]).applyMatrix4(_m);
        verts[k * 3] = _v.x;
        verts[k * 3 + 1] = _v.y;
        verts[k * 3 + 2] = _v.z;
        cx += _v.x;
        cz += _v.z;
      }
      if (Math.hypot(cx / b.vertexCount, cz / b.vertexCount) > reach) continue;
      const idx = new Uint32Array(b.indexCount);
      for (let k = 0; k < b.indexCount; k++) idx[k] = indices[b.indexStart + k]! - b.vertexStart;
      const collider = this.world.createCollider(
        this.R.ColliderDesc.trimesh(verts, idx).setFriction(0.8),
      );
      this.colliderBuilding.set(collider.handle, b.id);
      list.push(collider);
    }
    this.buildingColliders.set(cell.hash, list);
  }

  private removeCellColliders(hash: string): void {
    const list = this.buildingColliders.get(hash);
    if (!list) return;
    for (const c of list) {
      this.colliderBuilding.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    this.buildingColliders.delete(hash);
  }

  /** Statischen Collider eines Gebäudes entfernen (Zerstörung, Spec 7.2). */
  removeBuildingCollider(buildingId: number): void {
    this.suppressed.add(buildingId);
    for (const list of this.buildingColliders.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        if (this.colliderBuilding.get(c.handle) !== buildingId) continue;
        this.colliderBuilding.delete(c.handle);
        this.world.removeCollider(c, false);
        list.splice(i, 1);
      }
    }
  }

  /** Ein Gebäude wieder als statischen Collider führen (Bruch zurückgenommen). */
  restoreBuilding(buildingId: number): void {
    if (!this.suppressed.delete(buildingId)) return;
    for (const cell of this.cells.values()) {
      if (!cell.data.buildings.some((b) => b.id === buildingId)) continue;
      this.removeCellColliders(cell.hash);
      this.addCellColliders(cell);
    }
  }

  /** Zerstörte Gebäude wieder zulassen („Blase zurücksetzen“). */
  restoreBuildings(): void {
    this.suppressed.clear();
    for (const hash of [...this.buildingColliders.keys()]) this.removeCellColliders(hash);
    for (const cell of this.cells.values()) this.addCellColliders(cell);
  }

  /** Bekannte Gebäudezellen (für die Zerstörung). */
  get loadedCells(): IterableIterator<BuildingCell> {
    return this.cells.values();
  }

  get buildingColliderCount(): number {
    let n = 0;
    for (const l of this.buildingColliders.values()) n += l.length;
    return n;
  }

  // ---------------------------------------------------------------- Koordinaten

  /** Weltpunkt → Blasen-Frame. */
  worldToBubble(p: Vector3, out = new Vector3()): Vector3 {
    _inv.copy(this.group.matrixWorld).invert();
    return out.copy(p).applyMatrix4(_inv);
  }

  bubbleToWorld(p: Vector3, out = new Vector3()): Vector3 {
    return out.copy(p).applyMatrix4(this.group.matrixWorld);
  }

  /** Weltrichtung → Blasen-Frame (normiert). */
  dirToBubble(d: Vector3, out = new Vector3()): Vector3 {
    _inv.copy(this.group.matrixWorld).invert();
    return out.copy(d).transformDirection(_inv);
  }

  dirToWorld(d: Vector3, out = new Vector3()): Vector3 {
    return out.copy(d).transformDirection(this.group.matrixWorld);
  }

  /** Blasen-Frame → geodätisch. */
  geoToBubble(g: GeoPoint, out = new Vector3()): Vector3 {
    const l = this.frameValue!.ecefToLocal(geodeticToEcef(g, _e), _loc);
    return out.set(l.x, l.y, l.z);
  }

  bubbleToGeo(p: Vector3, out: GeoPoint = { lat: 0, lon: 0, height: 0 }): GeoPoint {
    if (!this.frameValue) throw new Error('keine Blase');
    return ecefToGeodetic(this.frameValue.localToEcef(p, _e), out);
  }

  // ---------------------------------------------------------------- Körper

  /**
   * Registriert einen Körper. `rb` ist bereits in der Welt; die Collider (mit `colliders`)
   * werden für Ereignisse zugeordnet. Überschreitet die Zahl das Budget, verschwinden die
   * ältesten und kleinsten Objekte (Spec 7.1).
   */
  register(
    kind: BodyKind,
    rb: RigidBody,
    colliders: Collider[],
    render: { pool?: InstancedPool; color?: number; scale?: Vector3; object?: Object3D },
    volume: number,
  ): SimBody {
    const t = rb.translation();
    const r = rb.rotation();
    const body: SimBody = {
      id: this.nextId++,
      kind,
      rb,
      volume,
      spawnedAt: this.time,
      sleptS: 0,
      frozen: false,
      atRest: false,
      pinned: false,
      debris: false,
      pool: render.pool ?? null,
      instance: render.pool ? render.pool.acquire(render.color ?? 0xffffff) : -1,
      object: render.object ?? null,
      scale: render.scale?.clone() ?? _one.clone(),
      prevPos: new Vector3(t.x, t.y, t.z),
      prevQuat: new Quaternion(r.x, r.y, r.z, r.w),
      pos: new Vector3(t.x, t.y, t.z),
      quat: new Quaternion(r.x, r.y, r.z, r.w),
      dying: -1,
    };
    if (body.object) this.group.add(body.object);
    for (const c of colliders) {
      c.setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
      this.colliderBody.set(c.handle, body);
    }
    this.bodies.set(body.id, body);
    this.enforceBudget();
    return body;
  }

  /** Erzeugt einen dynamischen Körper mit einem Collider (Bequemlichkeit für Fabriken). */
  createDynamic(
    x: number,
    y: number,
    z: number,
    desc: ColliderDesc,
    configure?: (d: RigidBodyDesc) => void,
  ): { rb: RigidBody; collider: Collider } {
    const bd = this.R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(false);
    configure?.(bd);
    const rb = this.world.createRigidBody(bd);
    const collider = this.world.createCollider(desc, rb);
    return { rb, collider };
  }

  private enforceBudget(): void {
    if (this.bodies.size <= this.maxBodies) return;
    const entries: BudgetEntry[] = [];
    for (const b of this.bodies.values()) {
      // Feste Gebäude-Bruchstücke kosten kaum Rechenzeit und zählen nicht zum Budget: sonst
      // verdrängen gebrochene, aber stehende Gebäude die herumfliegenden Trümmer
      if (b.kind === 'fragment' && b.pinned) continue;
      entries.push({
        id: b.id,
        spawnedAt: b.spawnedAt,
        volume: b.volume,
        debris: b.debris,
        pinned: b.pinned,
      });
    }
    for (const id of selectDespawn(entries, this.maxBodies)) {
      const b = this.bodies.get(id);
      if (b) this.removeBody(b, true);
    }
  }

  /** Entfernt einen Körper; mit `fade` schrumpft die Darstellung kurz (Spec 7.1). */
  removeBody(b: SimBody, fade = false): void {
    if (!this.bodies.has(b.id)) return;
    this.bodies.delete(b.id);
    // Zuerst Abhängiges (Fahrzeug-Controller, Gelenke) lösen, dann den Körper entfernen
    b.onRemove?.();
    if (b.rb) {
      for (let i = 0; i < b.rb.numColliders(); i++)
        this.colliderBody.delete(b.rb.collider(i).handle);
      this.world.removeRigidBody(b.rb);
      b.rb = null;
    }
    if (fade && (b.pool || b.object)) {
      b.dying = DESPAWN_FADE_S;
      this.dying.push(b);
    } else {
      this.freeRender(b);
    }
  }

  private freeRender(b: SimBody): void {
    if (b.pool) b.pool.release(b.instance);
    b.object?.removeFromParent();
    b.onFree?.();
  }

  /** Alle Körper entfernen (neue Blase, „Blase zurücksetzen“). */
  clearBodies(): void {
    for (const b of [...this.bodies.values()]) this.removeBody(b);
    for (const b of this.dying) this.freeRender(b);
    this.dying.length = 0;
  }

  /**
   * Schwerkraft als Vielfaches von g (Werkzeug `gravity`, 0 bis 3 g). Weckt alle beweglichen
   * Körper, damit schlafende und eingefrorene auf die neue Schwere reagieren.
   */
  setGravityScale(scale: number): void {
    const s = Math.max(0, scale);
    if (s === this.gravityScale) return;
    this.gravityScale = s;
    for (const b of this.bodies.values()) {
      if (b.pinned || !b.rb) continue;
      if (b.frozen) this.unfreeze(b);
      else b.rb.wakeUp();
    }
  }

  /** Eingefrorenen Körper wieder dynamisch machen. */
  unfreeze(b: SimBody): void {
    if (!b.frozen || !b.rb) return;
    b.rb.setBodyType(this.R.RigidBodyType.Dynamic, true);
    b.rb.wakeUp();
    b.frozen = false;
    b.atRest = false;
    b.sleptS = 0;
  }

  /** Körper im Umkreis (Blasen-Frame) wecken bzw. auftauen. */
  wakeNear(p: Vector3, radiusM: number): void {
    for (const b of this.bodiesNear(p, radiusM)) {
      if (b.frozen) this.unfreeze(b);
      else b.rb?.wakeUp();
    }
  }

  /** Körper, deren Mittelpunkt im Umkreis (Blasen-Frame) liegt. */
  bodiesNear(p: Vector3, radiusM: number, out: SimBody[] = []): SimBody[] {
    out.length = 0;
    const r2 = radiusM * radiusM;
    for (const b of this.bodies.values()) if (b.pos.distanceToSquared(p) <= r2) out.push(b);
    return out;
  }

  /** Körper zu einem Collider (für Raycasts der Werkzeuge). */
  bodyOf(collider: Collider): SimBody | null {
    return this.colliderBody.get(collider.handle) ?? null;
  }

  // ---------------------------------------------------------------- Abfragen

  /** Raycast in Weltkoordinaten gegen Gelände, Gebäude und Körper der Blase. */
  raycast(worldRay: Ray, maxDist = 20_000, exclude?: RigidBody): PhysicsHit | null {
    if (!this.frameValue || this.building) return null;
    _inv.copy(this.group.matrixWorld).invert();
    _ray.copy(worldRay).applyMatrix4(_inv);
    const ray = new this.R.Ray(_ray.origin, _ray.direction);
    const cast = () =>
      this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, exclude);
    let hit = cast();
    if (!hit) {
      // Strahlen genau auf einer Rasterkante des Heightfields verfehlen es (parry); 1 mm versetzt
      // erneut versuchen.
      ray.origin = { x: _ray.origin.x + 1e-3, y: _ray.origin.y, z: _ray.origin.z + 7e-4 };
      hit = cast();
    }
    if (!hit) return null;
    _v.copy(_ray.direction).multiplyScalar(hit.timeOfImpact).add(_ray.origin);
    const point = this.bubbleToWorld(_v, new Vector3());
    const normal = this.dirToWorld(
      _v2.set(hit.normal.x, hit.normal.y, hit.normal.z),
      new Vector3(),
    );
    return {
      point,
      normal,
      distance: point.distanceTo(worldRay.origin),
      body: this.bodyOf(hit.collider),
      buildingId: this.colliderBuilding.get(hit.collider.handle) ?? null,
    };
  }

  // ---------------------------------------------------------------- Simulation

  private readonly removeScratch: SimBody[] = [];

  /** Ein bewegter Körper trifft einen eingefrorenen: auftauen (samt Nachbarn). */
  private readonly onCollision = (h1: number, h2: number, started: boolean): void => {
    if (!started) return;
    const a = this.colliderBody.get(h1);
    const b = this.colliderBody.get(h2);
    if (a?.frozen && b?.rb && speed(b.rb) > 0.5) this.wakeNear(a.pos, 3);
    if (b?.frozen && a?.rb && speed(a.rb) > 0.5) this.wakeNear(b.pos, 3);
    if (a?.onHit && b) a.onHit(b);
    if (b?.onHit && a) b.onHit(a);
  };

  /** Ein fester Schritt (Spec 4.3: 60 Hz). */
  step(dt: number): void {
    if (!this.frameValue || this.building) return;
    this.world.timestep = dt;
    const gy = -STANDARD_GRAVITY * this.gravityScale;
    if (this.world.gravity.y !== gy) this.world.gravity = { x: 0, y: gy, z: 0 };
    for (const b of this.bodies.values()) {
      b.prevPos.copy(b.pos);
      b.prevQuat.copy(b.quat);
      if (b.npc && b.rb) this.stepNpc(b.npc, b.rb);
      b.onStep?.(dt);
    }
    this.world.step(this.events);
    this.time += dt;

    this.events.drainCollisionEvents(this.onCollision);

    const remove = this.removeScratch;
    remove.length = 0;
    for (const b of this.bodies.values()) {
      const rb = b.rb;
      // Eingefrorene Körper sind fest und bewegen sich nicht: nichts abzufragen
      if (!rb || b.frozen) continue;
      const t = rb.translation(_rt);
      const r = rb.rotation(_rr);
      b.pos.set(t.x, t.y, t.z);
      b.quat.set(r.x, r.y, r.z, r.w);
      if (outsideBubble(t.x, t.y, t.z, this.radiusValue)) {
        remove.push(b);
        continue;
      }
      if (b.kind === 'car' || b.pinned) continue;
      const prev = b.sleptS;
      b.sleptS = nextSleep(prev, rb.isSleeping(), dt);
      if (crossesFreeze(prev, b.sleptS)) {
        rb.setBodyType(this.R.RigidBodyType.Fixed, false);
        b.frozen = true;
      }
    }
    for (const b of remove) this.removeBody(b, true);
    remove.length = 0;
  }

  private stepNpc(npc: NpcState, rb: RigidBody): void {
    if (npc.fallen) return;
    const v = rb.linvel(_rv);
    const want = 1.3;
    const dx = Math.sin(npc.heading) * want;
    const dz = -Math.cos(npc.heading) * want;
    // Starker Stoß (Wurf, Druck): umfallen und liegen bleiben
    if (Math.hypot(v.x - dx, v.z - dz) > 3.5 || Math.abs(v.y) > 4) {
      npc.fallen = true;
      rb.setEnabledRotations(true, true, true, true);
      rb.setAngvel({ x: (this.random() - 0.5) * 4, y: 0, z: (this.random() - 0.5) * 4 }, true);
      return;
    }
    if (this.time >= npc.nextTurn) {
      npc.heading += (this.random() - 0.5) * 2.5;
      npc.nextTurn = this.time + 2 + this.random() * 4;
    }
    _rset.x = dx;
    _rset.y = v.y;
    _rset.z = dz;
    rb.setLinvel(_rset, true);
  }

  /** Darstellung interpolieren (alpha zwischen letztem und aktuellem Schritt) und ausblenden. */
  render(alpha: number, dt: number): void {
    for (const b of this.bodies.values()) {
      // SIMPLIFIED: Eingefrorene Körper bleiben in ihrem Instanz-Pool, werden aber nach der letzten
      // Ruhelage nicht mehr angefasst (kein eigener statischer InstancedMesh, ADR-020)
      if (b.atRest) continue;
      this.renderBody(b, alpha, 1);
      if (b.frozen && b.prevPos.equals(b.pos) && b.prevQuat.equals(b.quat)) b.atRest = true;
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const b = this.dying[i]!;
      b.dying -= dt;
      if (b.dying <= 0) {
        this.freeRender(b);
        this.dying.splice(i, 1);
      } else {
        this.renderBody(b, 1, b.dying / DESPAWN_FADE_S);
      }
    }
  }

  private renderBody(b: SimBody, alpha: number, k: number): void {
    _v.lerpVectors(b.prevPos, b.pos, alpha);
    _q.slerpQuaternions(b.prevQuat, b.quat, alpha);
    if (b.pool) {
      _v2.copy(b.scale).multiplyScalar(k);
      b.pool.set(b.instance, _v, _q, _v2);
    }
    if (b.object) {
      b.object.position.copy(_v);
      b.object.quaternion.copy(_q);
      b.object.scale.setScalar(k);
    }
  }

  /** Eine Gelenkverbindung entfernen (Abrissbirne). */
  removeJoint(j: ImpulseJoint): void {
    if (this.world.getImpulseJoint(j.handle)) this.world.removeImpulseJoint(j, true);
  }

  dispose(): void {
    this.clearBodies();
    for (const p of Object.values(this.pools)) p.dispose();
    this.group.removeFromParent();
    this.events.free();
    this.world.free();
  }
}

function speed(rb: RigidBody): number {
  const v = rb.linvel(_rv);
  return Math.hypot(v.x, v.y, v.z);
}
