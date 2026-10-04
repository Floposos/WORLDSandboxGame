import {
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { CAMERA_FRAME, GlobeControls, WGS84_ELLIPSOID } from '3d-tiles-renderer/three';
import { toDeg, toRad } from '../core/geo';
import { flightPose, planFlight, type CameraPose, type FlightPlan } from './flyTo';

const _m = new Matrix4();
const _inv = new Matrix4();
const _scale = new Vector3();
const _q = new Quaternion();
const _cart = { lat: 0, lon: 0, height: 0, azimuth: 0, elevation: 0, roll: 0 };
const _pcart = { lat: 0, lon: 0, height: 0 };
const _plocal = new Vector3();

/**
 * Liegt das gerenderte Gelände so weit unter der gemessenen Höhe, gilt es als noch grob
 * (feinere Kacheln fehlen) und die Kamera richtet sich nach der gemessenen Höhe.
 * Kleinere Abweichungen sind Geoid-Versatz (Terrarium orthometrisch, Meshes ellipsoidisch).
 */
export const COARSE_MESH_TOLERANCE_M = 150;

/** Liefert die Geländehöhe in m (oder null) für Breite/Länge in Grad. */
export type GroundHeightFn = (lat: number, lon: number) => number | null;

interface BelowHit {
  point: Vector3;
  distance: number;
}

/**
 * Wählt den Bodentreffer unter der Kamera: Mesh-Treffer, außer die gemessene Höhe liegt mehr als
 * {@link COARSE_MESH_TOLERANCE_M} darüber (oder es gibt keinen Treffer). Abstände in m entlang `up`.
 */
export function pickGroundDistance(
  meshDistance: number | null,
  pointHeight: number,
  groundHeight: number | null,
): number | null {
  if (groundHeight === null) return meshDistance;
  const sampled = pointHeight - groundHeight;
  if (meshDistance === null || meshDistance - sampled > COARSE_MESH_TOLERANCE_M) return sampled;
  return meshDistance;
}

/**
 * Globus-Kamera wie in Google Earth: `GlobeControls` aus 3d-tiles-renderer (Ziehen dreht die Erde,
 * rechte Maus/Strg neigt und dreht, Mausrad zoomt zum Cursor, Trägheit, Geländekollision)
 * plus „Fliege zu“.
 */
export class GlobeCamera {
  readonly controls: GlobeControls;
  private flight: { plan: FlightPlan; elapsed: number; resolve: () => void } | null = null;

  constructor(
    readonly camera: PerspectiveCamera,
    scene: Scene,
    private readonly globe: Object3D,
    domElement: HTMLElement,
    groundHeightAt: GroundHeightFn = () => null,
  ) {
    this.controls = new GlobeControls(scene, camera, domElement);
    this.controls.setEllipsoid(WGS84_ELLIPSOID, globe);
    this.controls.enableDamping = true;
    // Nie unter die Oberfläche; Mindestabstand zum Gelände in Metern.
    this.controls.cameraRadius = 5;
    this.controls.minDistance = 25;
    this.patchGroundQuery(groundHeightAt);
  }

  /**
   * GlobeControls hält die Kamera nur über dem gerenderten Mesh. Solange nur grobe Kacheln geladen
   * sind (langsames Netz), liegt das weit unter dem echten Gelände und die Kamera kann beim Neigen
   * in Berge eintauchen. Daher zusätzlich die gemessene Höhe berücksichtigen.
   */
  private patchGroundQuery(groundHeightAt: GroundHeightFn): void {
    // SIMPLIFIED: überschreibt die private Methode `_getPointBelowCamera` (3d-tiles-renderer 0.5.3).
    const controls = this.controls as unknown as {
      _getPointBelowCamera: (point?: Vector3, up?: Vector3) => BelowHit | null;
      up: Vector3;
    };
    const original = controls._getPointBelowCamera.bind(controls);
    controls._getPointBelowCamera = (point = this.camera.position, up = controls.up) => {
      const hit = original(point, up);
      this.globe.updateMatrixWorld();
      _plocal.copy(point).applyMatrix4(_inv.copy(this.globe.matrixWorld).invert());
      WGS84_ELLIPSOID.getPositionToCartographic(_plocal, _pcart);
      const ground = groundHeightAt(toDeg(_pcart.lat), toDeg(_pcart.lon));
      const dist = pickGroundDistance(hit?.distance ?? null, _pcart.height, ground);
      if (dist === null || dist === hit?.distance) return hit;
      return { point: point.clone().addScaledVector(up, -dist), distance: dist };
    };
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** Aktuelle Kamerapose in geografischen Größen. */
  getPose(out: CameraPose = { lat: 0, lon: 0, height: 0, heading: 0, pitch: 0 }): CameraPose {
    this.globe.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    _inv.copy(this.globe.matrixWorld).invert();
    _m.copy(this.camera.matrixWorld).premultiply(_inv);
    WGS84_ELLIPSOID.getCartographicFromObjectFrame(_m, _cart, CAMERA_FRAME);
    out.lat = toDeg(_cart.lat);
    out.lon = toDeg(_cart.lon);
    out.height = _cart.height;
    out.heading = (toDeg(_cart.azimuth) + 360) % 360;
    out.pitch = toDeg(_cart.elevation);
    return out;
  }

  /** Setzt die Kamera direkt auf eine Pose. */
  setPose(pose: CameraPose): void {
    this.globe.updateMatrixWorld();
    WGS84_ELLIPSOID.getObjectFrame(
      toRad(pose.lat),
      toRad(pose.lon),
      pose.height,
      toRad(pose.heading),
      toRad(pose.pitch),
      0,
      _m,
      CAMERA_FRAME,
    );
    _m.premultiply(this.globe.matrixWorld);
    _m.decompose(this.camera.position, _q, _scale);
    this.camera.quaternion.copy(_q);
    this.camera.updateMatrixWorld();
  }

  /** Startet einen Flug; das Promise erfüllt sich bei Ankunft (oder Abbruch). */
  flyTo(target: CameraPose, reduceMotion = false): Promise<void> {
    this.cancelFlight();
    const plan = planFlight(this.getPose(), target);
    if (reduceMotion) plan.durationS = Math.min(plan.durationS, 1);
    this.controls.enabled = false;
    return new Promise((resolve) => {
      this.flight = { plan, elapsed: 0, resolve };
    });
  }

  cancelFlight(): void {
    if (!this.flight) return;
    const { resolve } = this.flight;
    this.flight = null;
    this.controls.enabled = true;
    resolve();
  }

  /** Pro Frame mit echter Zeit (nicht von der Spiel-Zeitskala beeinflusst). */
  update(dt: number): void {
    if (this.flight) {
      const f = this.flight;
      f.elapsed += dt;
      const t = Math.min(1, f.elapsed / f.plan.durationS);
      this.setPose(flightPose(f.plan, t));
      if (t >= 1) {
        this.flight = null;
        this.controls.enabled = true;
        this.controls.resetState();
        f.resolve();
      }
      // Near/Far-Ebenen trotzdem anpassen.
      this.controls.adjustCamera(this.camera);
      return;
    }
    this.controls.update(dt);
  }

  dispose(): void {
    this.cancelFlight();
    this.controls.dispose();
  }
}
