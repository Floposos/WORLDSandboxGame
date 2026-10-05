import { BufferAttribute, BufferGeometry, Color, Mesh, Vector3, type Material } from 'three';
import { geodeticToEcef } from '../core/geo';
import type { GeoPoint, Vec3 } from '../core/types';
import type { BuildingCell } from '../world/buildings/buildingService';
import { WALL_SINK_M, type BuildingRange } from '../world/buildings/extrude';
import type { Footprint } from '../world/buildings/overpass';
import { aabbArea, blastImpulse, overpressureAt } from './blast';
import { fractureFootprint, isSupported, type FootprintPlan, type Fragment } from './fracture';
import type { PhysicsWorld, SimBody } from './world';

export type BuildingStatus = 'intact' | 'damaged' | 'collapsed';

/**
 * Ab diesem Überdruck bricht ein Bruchstück los (Pa). Mauerwerk versagt real ab etwa 35–70 kPa;
 * der Wert ist höher angesetzt, weil die Stücke ganze Stockwerksteile sind und die Abnahme
 * (500 kg in der Hamburger Altstadt) 1–3 eingestürzte Gebäude verlangt (ADR-022).
 */
export const BREAK_OVERPRESSURE_PA = 100_000;
/** Liegt ein anderes Gebäude zwischen Explosion und Stück, wirkt nur dieser Anteil des Drucks. */
export const SHIELD_FACTOR = 0.35;
/** Ab diesem Impuls (N·s) bricht ein Treffer (Abrissbirne, Auto) ein Bruchstück los. */
export const BREAK_HIT_IMPULSE = 6_000;
/** Ein ungestütztes Bruchstück fällt nach dieser Zeit (s): sichtbar stockwerksweise. */
export const UNSUPPORTED_DELAY_S = 0.18;
/** Anteil losgebrochener Stücke, ab dem ein Gebäude als eingestürzt gilt. */
export const COLLAPSED_SHARE = 0.55;
/** Ein Gebäude, dessen Bruch nichts gelöst hat, wird so lange nicht erneut gebrochen (s). */
export const DAMAGE_COOLDOWN_S = 1;
/** Effektive Dichte der Bruchstücke (kg/m³): Gebäude sind überwiegend Luft. */
export const FRAGMENT_DENSITY = 450;
/** Höchstens diese Geschwindigkeit (m/s) erhält ein Bruchstück von der Druckwelle. */
export const MAX_FRAGMENT_DV = 25;

const INTERIOR = new Color(0x8b8580);
const SLAB = new Color(0x77726c);
const _ecef: Vec3 = { x: 0, y: 0, z: 0 };
const _loc: Vec3 = { x: 0, y: 0, z: 0 };
const _v = new Vector3();
const _impulse = { x: 0, y: 0, z: 0 };
const _pos = new Vector3();
const _dv = new Vector3();

/** Gebäude im Umkreis: Zelle, Bereich, Grundriss, Plan-Abstand und Lage im Blasen-Frame. */
export interface NearBuilding {
  cell: BuildingCell;
  range: BuildingRange;
  footprint: Footprint;
  dist: number;
  x: number;
  z: number;
}

/** Eigene Schadensregel (Tornado, Erdbeben, Tsunami): wer bricht, wie stark fliegt ein Stück. */
export interface DamageRule {
  /** Ist das Gebäude betroffen? Nur dann wird es vorab gebrochen (spart Körper). */
  building(b: {
    id: number;
    dist: number;
    height: number;
    areaM2: number;
    x: number;
    z: number;
  }): boolean;
  /**
   * Fest stehendes Stück an `pos` (Blasen-Frame), relative Höhe im Gebäude `rel` (0 unten,
   * 1 Dach): true löst es, `dv` ist dann seine Anfangsgeschwindigkeit (m/s).
   */
  fragment(pos: Vector3, rel: number, dv: Vector3): boolean;
}

interface FragmentState {
  frag: Fragment;
  body: SimBody;
  loose: boolean;
  /** Seit wann ungestützt (s Simulationszeit), −1 = gestützt. */
  unsupportedSince: number;
  size: Vector3;
}

interface Wreck {
  id: number;
  cell: BuildingCell;
  range: BuildingRange;
  footprint: Footprint;
  frags: FragmentState[];
  status: BuildingStatus;
  /** Mittelpunkt im Blasen-Frame. */
  center: Vector3;
  /** Unter- und Oberkante (Blasen-y) für die relative Höhe eines Stücks. */
  bottom: number;
  top: number;
  /** Ohne Explosion beschädigt (Tornado, Erdbeben, Tsunami): Statuswechsel ohne Feuer. */
  quiet: boolean;
  /** Strukturtest: ist Stück i noch fest? (einmal erzeugt, keine Allokation pro Schritt) */
  isFixed: (i: number) => boolean;
}

export interface DestructionOptions {
  material: Material;
  /** Zellen-Mesh: Gebäude ausblenden (Index-Bereich degeneriert). */
  hideInCell: (cell: BuildingCell, range: BuildingRange) => void;
  /** Zellen-Mesh: Gebäude wieder zeigen (Bruch ohne Wirkung zurückgenommen). */
  showInCell?: (cell: BuildingCell, range: BuildingRange) => void;
  /**
   * Statuswechsel (Store, Ereignisse, Maskierung im Tiles-Modus). `quiet`: ohne Effekte
   * (verdampft unter einem Meteor oder unter Lava begraben, viele Gebäude auf einmal).
   */
  onStatus?: (
    id: number,
    status: BuildingStatus,
    fp: Footprint,
    base: number,
    quiet?: boolean,
  ) => void;
  /** Ein Bruchstück bricht los (Staub, Funken, Ton). */
  onLoose?: (posBubble: Vector3, volume: number) => void;
  /** Zellen je Stockwerk (Preset), Faktor auf die flächenabhängige Zahl. */
  cellScale?: () => number;
}

/**
 * Zerstörungs-Pipeline (Spec 7.2, Schritte 4–7): Gebäude werden beim ersten starken Treffer
 * vorab in Stockwerke und Voronoi-Zellen gebrochen. Die Stücke sind zunächst feste Körper (der
 * statische Gebäude-Collider entfällt); Überdruck oder Treffer lösen sie, der Strukturtest lässt
 * ungestützte Stockwerke nachfallen.
 */
export class Destruction {
  private readonly wrecks = new Map<number, Wreck>();
  private readonly destroyed = new Map<number, BuildingStatus>();
  /** Zuletzt ohne Wirkung zurückgenommene Brüche (ID → Zeit): nicht sofort erneut brechen. */
  private readonly cooldown = new Map<number, number>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly opts: DestructionOptions,
  ) {}

  statusOf(id: number): BuildingStatus {
    return this.destroyed.get(id) ?? 'intact';
  }

  get statuses(): ReadonlyMap<number, BuildingStatus> {
    return this.destroyed;
  }

  get wreckCount(): number {
    return this.wrecks.size;
  }

  /** Gebäude im Umkreis (Blasen-Frame) mit Zelle, Bereich und Grundriss. */
  buildingsNear(center: Vector3, radiusM: number): NearBuilding[] {
    const frame = this.physics.frame;
    if (!frame) return [];
    const out: NearBuilding[] = [];
    for (const cell of this.physics.loadedCells) {
      const byId = new Map(cell.footprints.map((f) => [f.id, f]));
      for (const range of cell.data.buildings) {
        const fp = byId.get(range.id);
        if (!fp) continue;
        this.toBubble(fp.lat, fp.lon, range.base, _v);
        const reach = radiusM + Math.sqrt(fp.areaM2) * 0.7;
        const d = Math.hypot(_v.x - center.x, _v.z - center.z);
        if (d <= reach) out.push({ cell, range, footprint: fp, dist: d, x: _v.x, z: _v.z });
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  private toBubble(lat: number, lon: number, h: number, out: Vector3): Vector3 {
    const frame = this.physics.frame!;
    const g: GeoPoint = { lat, lon, height: h };
    const l = frame.ecefToLocal(geodeticToEcef(g, _ecef), _loc);
    return out.set(l.x, l.y, l.z);
  }

  /** Gebäude vorab brechen (idempotent). Liefert null, wenn es schon zerstört ist. */
  fracture(cell: BuildingCell, range: BuildingRange, fp: Footprint): Wreck | null {
    if (this.wrecks.has(range.id)) return this.wrecks.get(range.id)!;
    if (this.destroyed.has(range.id) || !this.physics.frame) return null;
    // Plan-Koordinaten (x = Ost, n = Nord) im Blasen-Frame; Sockel = mittlere Fußpunkthöhe
    const poly = fp.polygons[0];
    if (!poly) return null;
    let ySum = 0;
    let yCount = 0;
    const toPlan = (ring: number[]): number[] => {
      const out: number[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        this.toBubble(ring[i + 1]!, ring[i]!, range.base, _v);
        out.push(_v.x, -_v.z);
        ySum += _v.y;
        yCount++;
      }
      return out;
    };
    const plan: FootprintPlan = { outer: toPlan(poly.outer), holes: poly.holes.map(toPlan) };
    const yBase = ySum / Math.max(1, yCount);
    const bottom = fp.minHeight > 0 ? yBase + fp.minHeight : yBase - WALL_SINK_M * 0.5;
    const top = yBase + range.height;
    let result;
    try {
      result = fractureFootprint(plan, {
        bottom,
        top,
        cells: undefined,
        random: () => this.physics.random(),
        maxLayers: 12,
      });
    } catch (err) {
      console.warn('[destruction] Bruch fehlgeschlagen', range.id, err);
      return null;
    }
    if (result.fragments.length === 0) return null;
    const scale = this.opts.cellScale?.() ?? 1;
    void scale; // SIMPLIFIED: Zellen je Stockwerk nur aus der Fläche (Preset-Faktor folgt in M7)

    this.physics.removeBuildingCollider(range.id);
    this.opts.hideInCell(cell, range);

    const wall = new Color().setHex(fp.wallColour);
    const roof = new Color().setHex(fp.roofColour);
    const tEdge = edgeCounts(result.triangles);
    const wreck: Wreck = {
      id: range.id,
      cell,
      range,
      footprint: fp,
      frags: [],
      status: 'intact',
      center: this.toBubble(fp.lat, fp.lon, range.base, new Vector3()),
      bottom,
      top,
      quiet: false,
      isFixed: (i) => {
        const f = wreck.frags[i];
        return f !== undefined && !f.loose;
      },
    };
    const R = this.physics.R;
    for (const frag of result.fragments) {
      const isTop = frag.layer === result.layers - 1;
      const g = fragmentGeometry(result.triangles, frag, tEdge, yBase, wall, isTop ? roof : SLAB);
      if (!g) continue;
      const mesh = new Mesh(g.geometry, this.opts.material);
      mesh.name = 'fragment';
      const rb = this.physics.world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(frag.cx, frag.cy, -frag.cn),
      );
      const desc =
        R.ColliderDesc.convexHull(g.hull) ??
        R.ColliderDesc.cuboid(g.size.x / 2, g.size.y / 2, g.size.z / 2);
      desc.setDensity(FRAGMENT_DENSITY).setFriction(0.9).setRestitution(0.05);
      const collider = this.physics.world.createCollider(desc, rb);
      const volume = frag.area * (frag.yTop - frag.yBottom);
      const body = this.physics.register('fragment', rb, [collider], { object: mesh }, volume);
      body.pinned = true;
      const state: FragmentState = { frag, body, loose: false, unsupportedSince: -1, size: g.size };
      body.onHit = (other) => this.onHit(wreck, state, other);
      body.onRemove = () => {
        state.loose = true;
      };
      body.onFree = () => g.geometry.dispose();
      wreck.frags.push(state);
    }
    this.wrecks.set(range.id, wreck);
    return wreck;
  }

  /**
   * Druckwelle auf Gebäude: bricht Gebäude im Wirkungsbereich vorab und löst Stücke über dem
   * Bruch-Überdruck (mit Impuls weg vom Zentrum). `center` im Blasen-Frame.
   */
  applyBlast(center: Vector3, tntKg: number, maxBuildings = Infinity): number {
    // Reichweite, in der überhaupt etwas bricht: Überdruck ≥ Bruchschwelle
    let reach = 1;
    while (reach < 2_000 && overpressureAt(reach, tntKg) > BREAK_OVERPRESSURE_PA) reach *= 1.15;
    let loosened = 0;
    // Nächste zuerst; sehr große Explosionen (Meteor) brechen nur die nächsten Gebäude
    const near = this.buildingsNear(center, reach)
      .filter((b) => this.statusOf(b.range.id) !== 'collapsed' || this.wrecks.has(b.range.id))
      .slice(0, maxBuildings);
    // Abschirmung (SIMPLIFIED): Grundrisse stehender Gebäude im Plan, mit Oberkante
    const shields = near
      .filter((b) => this.statusOf(b.range.id) !== 'collapsed')
      .map((b) => this.shieldOf(b.range, b.footprint));
    for (const b of near) {
      const fresh = !this.wrecks.has(b.range.id);
      const wreck = this.fracture(b.cell, b.range, b.footprint);
      if (!wreck) continue;
      const before = loosened;
      for (const s of wreck.frags) {
        if (s.loose || !s.body.rb) continue;
        _v.set(s.frag.cx, s.frag.cy, -s.frag.cn).sub(center);
        // Abstand zur nächsten Seite des Stücks, nicht zur Mitte
        const d = Math.max(0.5, _v.length() - Math.max(s.size.x, s.size.z) * 0.5);
        let p = overpressureAt(d, tntKg);
        if (p < BREAK_OVERPRESSURE_PA) continue;
        if (shielded(shields, b.range.id, center, s.frag)) p *= SHIELD_FACTOR;
        if (p < BREAK_OVERPRESSURE_PA) continue;
        this.loosen(wreck, s);
        wreck.quiet = false;
        const rb = s.body.rb;
        const mass = rb.mass();
        const j = Math.min(
          blastImpulse(d, tntKg, aabbArea(s.size.x, s.size.y, s.size.z), mass),
          MAX_FRAGMENT_DV * mass,
        );
        _v.normalize();
        _v.y = Math.max(_v.y, 0.15);
        _v.normalize();
        _impulse.x = _v.x * j;
        _impulse.y = _v.y * j;
        _impulse.z = _v.z * j;
        rb.applyImpulse(_impulse, true);
        loosened++;
      }
      // Nichts gelöst: Bruch zurücknehmen (spart Körper und Draw-Calls)
      if (fresh && loosened === before) this.unfracture(wreck);
      else this.updateStatus(wreck);
    }
    return loosened;
  }

  /**
   * Schaden nach eigener Regel im Umkreis (Plan-Abstand). Höchstens `maxNew` Gebäude werden in
   * diesem Aufruf neu gebrochen (Rechenzeit). Liefert die Zahl losgebrochener Stücke.
   */
  damage(center: Vector3, radiusM: number, rule: DamageRule, maxNew = Infinity): number {
    let loosened = 0;
    let fresh = 0;
    for (const b of this.buildingsNear(center, radiusM)) {
      const id = b.range.id;
      const existing = this.wrecks.has(id);
      if (!existing && (fresh >= maxNew || this.destroyed.get(id) === 'collapsed')) continue;
      const cool = this.cooldown.get(id);
      if (!existing && cool !== undefined && this.physics.time - cool < DAMAGE_COOLDOWN_S) continue;
      const info = {
        id,
        dist: b.dist,
        height: b.range.height,
        areaM2: b.footprint.areaM2,
        x: b.x,
        z: b.z,
      };
      if (!rule.building(info)) continue;
      const wreck = this.fracture(b.cell, b.range, b.footprint);
      if (!wreck) continue;
      if (!existing) fresh++;
      const before = loosened;
      const span = Math.max(0.1, wreck.top - wreck.bottom);
      for (const st of wreck.frags) {
        const rb = st.body.rb;
        if (st.loose || !rb) continue;
        _pos.set(st.frag.cx, st.frag.cy, -st.frag.cn);
        _dv.set(0, 0, 0);
        if (!rule.fragment(_pos, (st.frag.cy - wreck.bottom) / span, _dv)) continue;
        this.loosen(wreck, st);
        const mass = rb.mass();
        const len = _dv.length();
        if (len > MAX_FRAGMENT_DV) _dv.multiplyScalar(MAX_FRAGMENT_DV / len);
        _impulse.x = _dv.x * mass;
        _impulse.y = _dv.y * mass;
        _impulse.z = _dv.z * mass;
        rb.applyImpulse(_impulse, true);
        loosened++;
      }
      if (!existing && loosened === before) {
        this.unfracture(wreck);
        this.cooldown.set(id, this.physics.time);
      } else {
        // Ohne Explosion kein Gebäudefeuer
        wreck.quiet = true;
        this.updateStatus(wreck);
      }
    }
    return loosened;
  }

  /**
   * Gebäude, deren Mitte im Umkreis liegt, verschwinden ohne Bruchstücke (Meteorkrater, unter
   * dem Vulkankegel begraben): ausgeblendet, Collider weg, Status „eingestürzt“.
   */
  vaporize(center: Vector3, radiusM: number): number {
    let n = 0;
    for (const b of this.buildingsNear(center, radiusM)) {
      if (b.dist > radiusM) continue;
      const id = b.range.id;
      const wreck = this.wrecks.get(id);
      if (wreck) {
        this.wrecks.delete(id);
        for (const st of wreck.frags) {
          st.body.onRemove = undefined;
          this.physics.removeBody(st.body);
        }
      } else if (this.destroyed.get(id) === 'collapsed') {
        continue;
      } else {
        this.physics.removeBuildingCollider(id);
        this.opts.hideInCell(b.cell, b.range);
      }
      this.destroyed.set(id, 'collapsed');
      this.opts.onStatus?.(id, 'collapsed', b.footprint, b.range.base, true);
      n++;
    }
    return n;
  }

  /** Vorab-Bruch ohne Wirkung zurücknehmen: Stücke weg, Gebäude-Collider und Mesh wieder da. */
  private unfracture(wreck: Wreck): void {
    this.wrecks.delete(wreck.id);
    for (const s of wreck.frags) {
      s.body.onRemove = undefined;
      this.physics.removeBody(s.body);
    }
    this.physics.restoreBuilding(wreck.id);
    this.opts.showInCell?.(wreck.cell, wreck.range);
  }

  /** Grundriss im Plan des Blasen-Frames (x, z) und Oberkante (y) für die Abschirmung. */
  private shieldOf(range: BuildingRange, fp: Footprint): Shield {
    const ring = fp.polygons[0]?.outer ?? [];
    const poly = new Float64Array(ring.length);
    let top = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      this.toBubble(ring[i + 1]!, ring[i]!, range.base, _v);
      poly[i] = _v.x;
      poly[i + 1] = _v.z;
      top = Math.max(top, _v.y + range.height);
    }
    return { id: range.id, poly, top };
  }

  private onHit(wreck: Wreck, s: FragmentState, other: SimBody): void {
    if (s.loose || !other.rb || other.kind === 'fragment') return;
    const v = other.rb.linvel();
    const p = other.rb.mass() * Math.hypot(v.x, v.y, v.z);
    if (p < BREAK_HIT_IMPULSE) return;
    this.loosen(wreck, s);
    this.updateStatus(wreck);
  }

  private loosen(wreck: Wreck, s: FragmentState): void {
    if (s.loose || !s.body.rb) return;
    s.loose = true;
    s.body.rb.setBodyType(this.physics.R.RigidBodyType.Dynamic, true);
    s.body.rb.wakeUp();
    s.body.pinned = false;
    s.body.debris = true;
    s.body.spawnedAt = this.physics.time;
    this.opts.onLoose?.(s.body.pos, s.body.volume);
    void wreck;
  }

  /** Strukturtest (pro festem Schritt): ungestützte Stücke fallen verzögert nach. */
  step(): void {
    const now = this.physics.time;
    for (const wreck of this.wrecks.values()) {
      let changed = false;
      for (const s of wreck.frags) {
        if (s.loose) continue;
        if (isSupported(s.frag, wreck.isFixed)) {
          s.unsupportedSince = -1;
          continue;
        }
        if (s.unsupportedSince < 0) s.unsupportedSince = now;
        else if (now - s.unsupportedSince >= UNSUPPORTED_DELAY_S) {
          this.loosen(wreck, s);
          changed = true;
        }
      }
      if (changed) this.updateStatus(wreck);
    }
  }

  private updateStatus(wreck: Wreck): void {
    let loose = 0;
    for (const f of wreck.frags) if (f.loose) loose++;
    const share = loose / Math.max(1, wreck.frags.length);
    const status: BuildingStatus =
      share >= COLLAPSED_SHARE ? 'collapsed' : loose > 0 ? 'damaged' : 'intact';
    if (status === wreck.status) return;
    wreck.status = status;
    if (status !== 'intact') this.destroyed.set(wreck.id, status);
    this.opts.onStatus?.(wreck.id, status, wreck.footprint, wreck.range.base, wreck.quiet);
  }

  /** Neue Blase: Bruchstücke sind weg, zerstörte Gebäude bleiben ausgeblendet. */
  onBubbleReset(): void {
    this.wrecks.clear();
    this.cooldown.clear();
  }

  /** „Blase zurücksetzen“: alles wieder intakt. */
  reset(): void {
    this.wrecks.clear();
    this.destroyed.clear();
  }
}

interface Shield {
  id: number;
  /** x, z abwechselnd. */
  poly: Float64Array;
  top: number;
}

/** Steht ein anderes Gebäude zwischen `center` und dem Stück (Plan, unterhalb seiner Oberkante)? */
function shielded(
  shields: readonly Shield[],
  ownId: number,
  center: Vector3,
  f: Fragment,
): boolean {
  const bx = f.cx;
  const bz = -f.cn;
  for (const sh of shields) {
    if (sh.id === ownId || f.yBottom >= sh.top) continue;
    if (segmentCrossesPolygon(center.x, center.z, bx, bz, sh.poly)) return true;
  }
  return false;
}

/** Schneidet die Strecke a→b den Polygonrand oder liegt a im Polygon (x, z abwechselnd)? */
export function segmentCrossesPolygon(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  poly: ArrayLike<number>,
): boolean {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const zi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const zj = poly[j * 2 + 1]!;
    if (zi > az !== zj > az && ax < ((xj - xi) * (az - zi)) / (zj - zi) + xi) inside = !inside;
    if (segmentsIntersect(ax, az, bx, bz, xi, zi, xj, zj)) return true;
  }
  return inside;
}

function segmentsIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Wie oft jede Kante (quantisiert) in den kleinen Dreiecken vorkommt. */
function edgeCounts(tris: Float32Array): Map<string, number> {
  const m = new Map<string, number>();
  for (let t = 0; t < tris.length / 6; t++) {
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(tris, t, e);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

function q(v: number): number {
  return Math.round(v * 1000);
}

function edgeKey(tris: Float32Array, t: number, e: number): string {
  const o = t * 6;
  const a = o + e * 2;
  const b = o + ((e + 1) % 3) * 2;
  const ax = q(tris[a]!);
  const an = q(tris[a + 1]!);
  const bx = q(tris[b]!);
  const bn = q(tris[b + 1]!);
  return ax < bx || (ax === bx && an < bn) ? `${ax},${an},${bx},${bn}` : `${bx},${bn},${ax},${an}`;
}

/**
 * Prisma eines Bruchstücks relativ zu seinem Mittelpunkt: Deckel, Boden und Wände an den
 * Rändern des Stücks. Außenwände tragen Fassade (Fensterraster), Bruchflächen Betongrau.
 */
export function fragmentGeometry(
  tris: Float32Array,
  frag: Fragment,
  globalEdges: Map<string, number>,
  yBase: number,
  wall: Color,
  cap: Color,
): { geometry: BufferGeometry; hull: Float32Array; size: Vector3 } | null {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const fac: number[] = [];
  const cx = frag.cx;
  const cy = frag.cy;
  const cz = -frag.cn;
  const yb = frag.yBottom - cy;
  const yt = frag.yTop - cy;
  const vBase = frag.yBottom - yBase;
  const vTop = frag.yTop - yBase;
  const local = new Map<string, number>();
  for (const t of frag.tris) {
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(tris, t, e);
      local.set(k, (local.get(k) ?? 0) + 1);
    }
  }
  const push = (
    x: number,
    y: number,
    z: number,
    n: [number, number, number],
    c: Color,
    u: number,
    v: number,
  ): void => {
    pos.push(x - cx, y, z - cz);
    nor.push(n[0], n[1], n[2]);
    col.push(c.r, c.g, c.b);
    fac.push(u, v);
  };
  /** Dreieck mit gewünschter Normale; Wicklung passend wählen. */
  const tri = (
    p: [number, number, number][],
    n: [number, number, number],
    c: Color,
    uv: [number, number][],
  ): void => {
    const [a, b, d] = p as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const order = fx * n[0] + fy * n[1] + fz * n[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) push(p[i]![0], p[i]![1], p[i]![2], n, c, uv[i]![0], uv[i]![1]);
  };
  const up: [number, number, number] = [0, 1, 0];
  const down: [number, number, number] = [0, -1, 0];
  const none: [number, number][] = [
    [-1, -1],
    [-1, -1],
    [-1, -1],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of frag.tris) {
    const o = t * 6;
    const P = [0, 1, 2].map((i) => [tris[o + i * 2]!, -tris[o + i * 2 + 1]!] as const);
    for (const [x, z] of P) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    tri(
      P.map(([x, z]) => [x, yt, z] as [number, number, number]),
      up,
      cap,
      none,
    );
    tri(
      P.map(([x, z]) => [x, yb, z] as [number, number, number]),
      down,
      SLAB,
      none,
    );
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(tris, t, e);
      if ((local.get(k) ?? 0) > 1) continue; // innen im Stück
      const outer = (globalEdges.get(k) ?? 0) === 1;
      const [ax, az] = P[e]!;
      const [bx, bz] = P[(e + 1) % 3]!;
      const [ox, oz] = P[(e + 2) % 3]!;
      // Normale zeigt vom gegenüberliegenden Eckpunkt weg
      let nx = bz - az;
      let nz = -(bx - ax);
      const len = Math.hypot(nx, nz);
      if (len < 1e-4) continue;
      nx /= len;
      nz /= len;
      if ((ox - ax) * nx + (oz - az) * nz > 0) {
        nx = -nx;
        nz = -nz;
      }
      const n: [number, number, number] = [nx, 0, nz];
      const c = outer ? wall : INTERIOR;
      // Fassade: u entlang der Wand (global stetig), v Höhe über dem Sockel
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const ua = outer ? ax * dx + az * dz : -1;
      const ub = outer ? bx * dx + bz * dz : -1;
      const vb = outer ? vBase : -1;
      const vt = outer ? vTop : -1;
      tri(
        [
          [ax, yb, az],
          [bx, yb, bz],
          [bx, yt, bz],
        ],
        n,
        c,
        [
          [ua, vb],
          [ub, vb],
          [ub, vt],
        ],
      );
      tri(
        [
          [ax, yb, az],
          [bx, yt, bz],
          [ax, yt, az],
        ],
        n,
        c,
        [
          [ua, vb],
          [ub, vt],
          [ua, vt],
        ],
      );
    }
  }
  if (pos.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.setAttribute('facade', new BufferAttribute(new Float32Array(fac), 2));
  geometry.computeBoundingSphere();
  // Hülle: Ecken der Grundfläche oben und unten (Rapier bildet daraus die konvexe Hülle)
  const hull: number[] = [];
  const seen = new Set<string>();
  for (const t of frag.tris) {
    const o = t * 6;
    for (let i = 0; i < 3; i++) {
      const x = tris[o + i * 2]! - cx;
      const z = -tris[o + i * 2 + 1]! - cz;
      const k = `${q(x)},${q(z)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      hull.push(x, yb, z, x, yt, z);
    }
  }
  const size = new Vector3(maxX - minX, yt - yb, maxZ - minZ);
  return { geometry, hull: new Float32Array(hull), size };
}
