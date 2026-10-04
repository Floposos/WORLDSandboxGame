import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { ORIGIN_SHIFT_THRESHOLD_M } from './constants';
import type { EventBus, GameEvents } from './events';
import { ecefToGeodetic, enuBasis, geodeticToEcef, LocalFrame } from './geo';
import type { GeoPoint, Vec3 } from './types';

/**
 * Ab welcher Entfernung Kamera–Ursprung neu zentriert wird: am Boden exakt
 * {@link ORIGIN_SHIFT_THRESHOLD_M} (5 km), mit wachsender Höhe 2 × Höhe, damit im All nicht jedes
 * Frame verschoben wird (dort ist die Präzision ohnehin unkritisch).
 */
export function shiftThreshold(heightAboveGroundM: number): number {
  return Math.max(ORIGIN_SHIFT_THRESHOLD_M, 2 * Math.max(0, heightAboveGroundM));
}

/** Muss der Ursprung verschoben werden? */
export function needsShift(distanceToOriginM: number, heightAboveGroundM: number): boolean {
  return distanceToOriginM > shiftThreshold(heightAboveGroundM);
}

/**
 * Matrix (spaltenweise, 16 Werte), die alte lokale Koordinaten auf neue abbildet:
 * D = M_neu · M_alt⁻¹ mit M = ECEF → lokal.
 */
export function shiftMatrix(from: LocalFrame, to: LocalFrame): Matrix4 {
  const mOld = new Matrix4().fromArray(from.ecefToLocalMatrix());
  const mNew = new Matrix4().fromArray(to.ecefToLocalMatrix());
  return mNew.multiply(mOld.invert());
}

export interface EnuBasis {
  east: Vector3;
  north: Vector3;
  up: Vector3;
}

export const createBasis = (): EnuBasis => ({
  east: new Vector3(1, 0, 0),
  north: new Vector3(0, 0, -1),
  up: new Vector3(0, 1, 0),
});

const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _v = new Vector3();
const _s = new Vector3();
const _inv = new Matrix4();

/**
 * Floating Origin (Spec 4.2, ADR-016): Die Welt-Koordinaten von three.js sind der lokale
 * ENU-Frame um den Ursprung O (x = Ost, y = Oben, z = −Nord). Die Gruppe `globe` (alle Tiles,
 * Atmosphäre) trägt die Matrix ECEF → lokal, Spielobjekte hängen in `local`.
 */
export class FloatingOrigin {
  /** Gruppe für Spielobjekte (Objekte, Vorschau, später Physik-Proxies). */
  readonly local = new Group();
  private frameValue: LocalFrame;
  private readonly matrix = new Matrix4();
  /** Zahl der bisherigen Verschiebungen (Diagnose, Tests). */
  shifts = 0;

  constructor(
    private readonly globe: Object3D,
    origin: GeoPoint,
    private readonly events?: EventBus<GameEvents>,
  ) {
    this.local.name = 'local';
    this.globe.matrixAutoUpdate = false;
    this.frameValue = new LocalFrame({ ...origin, height: 0 });
    this.applyGlobeMatrix();
  }

  get frame(): LocalFrame {
    return this.frameValue;
  }

  get origin(): GeoPoint {
    return this.frameValue.origin;
  }

  private applyGlobeMatrix(): void {
    this.matrix.fromArray(this.frameValue.ecefToLocalMatrix());
    this.globe.matrix.copy(this.matrix);
    this.globe.matrixWorldNeedsUpdate = true;
    this.globe.updateMatrixWorld(true);
  }

  /** Weltposition (lokal) → geodätisch. */
  worldToGeo(pos: Vec3, out: GeoPoint = { lat: 0, lon: 0, height: 0 }): GeoPoint {
    const ecef = this.frameValue.localToEcef(pos);
    return ecefToGeodetic(ecef, out);
  }

  /** Geodätisch → Weltposition (lokal). */
  geoToWorld(geo: GeoPoint, out = new Vector3()): Vector3 {
    const local = this.frameValue.ecefToLocal(geodeticToEcef(geo));
    return out.set(local.x, local.y, local.z);
  }

  /**
   * ENU-Achsen (Ost, Nord, Oben) am Ort `pos` als Welt-Richtungen. Am Ursprung sind das
   * (1,0,0), (0,0,−1), (0,1,0); weiter weg drehen sie mit der Erdkrümmung mit.
   */
  basisAt(pos: Vector3, out: EnuBasis = createBasis()): EnuBasis {
    const b = enuBasis(this.worldToGeo(pos, _geo));
    out.east.set(b.east.x, b.east.y, b.east.z).transformDirection(this.matrix);
    out.north.set(b.north.x, b.north.y, b.north.z).transformDirection(this.matrix);
    out.up.set(b.up.x, b.up.y, b.up.z).transformDirection(this.matrix);
    return out;
  }

  /**
   * Verschiebt den Ursprung auf den Fußpunkt (h = 0) von `newOrigin`. Kamera und alle Kinder von
   * `local` werden mitgenommen; `extra` sind weitere Objekte in Weltkoordinaten (z. B. die Kamera).
   * Liefert D (alt → neu lokal).
   */
  shiftTo(newOrigin: GeoPoint, extra: Object3D[] = []): Matrix4 {
    const from = this.frameValue;
    const to = new LocalFrame({ lat: newOrigin.lat, lon: newOrigin.lon, height: 0 });
    const d = shiftMatrix(from, to);
    this.frameValue = to;
    this.applyGlobeMatrix();
    for (const obj of [...this.local.children, ...extra]) applyToObject(obj, d);
    this.shifts++;
    const deltaLocal: Vec3 = { x: d.elements[12], y: d.elements[13], z: d.elements[14] };
    this.events?.emit('originShifted', {
      origin: { ...to.origin },
      newOriginEcef: { ...to.originEcef },
      deltaLocal,
      matrix: [...d.elements],
    });
    return d;
  }

  /** Verschiebt, falls nötig, auf den Fußpunkt der Kamera. Liefert D oder null. */
  maybeShift(
    cameraPos: Vector3,
    heightAboveGroundM: number,
    extra: Object3D[] = [],
  ): Matrix4 | null {
    if (!needsShift(cameraPos.length(), heightAboveGroundM)) return null;
    return this.shiftTo(this.worldToGeo(cameraPos), extra);
  }
}

/** Wendet D auf Position und Orientierung eines Objekts an (Objekte ohne Eltern-Transform). */
export function applyToObject(obj: Object3D, d: Matrix4): void {
  obj.updateMatrix();
  _inv.copy(d).multiply(obj.matrix);
  _inv.decompose(obj.position, obj.quaternion, _s);
  obj.updateMatrixWorld(true);
}

/** Wendet D auf einen Punkt an. */
export function applyToPoint(p: Vector3, d: Matrix4): Vector3 {
  return p.applyMatrix4(d);
}

/** Wendet die Rotation von D auf eine Richtung an (Länge bleibt). */
export function applyToDirection(v: Vector3, d: Matrix4): Vector3 {
  const len = v.length();
  if (len === 0) return v;
  return v.transformDirection(d).multiplyScalar(len);
}

/** Rotation von D als Quaternion. */
export function rotationOf(d: Matrix4, out = new Quaternion()): Quaternion {
  d.decompose(_v, out, _s);
  return out;
}
