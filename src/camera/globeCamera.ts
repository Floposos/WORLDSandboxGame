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
import { chooseGroundHeight } from '../world/ground';
import { flightPose, planFlight, type CameraPose, type FlightPlan } from './flyTo';

const _m = new Matrix4();
const _inv = new Matrix4();
const _scale = new Vector3();
const _q = new Quaternion();
const _cart = { lat: 0, lon: 0, height: 0, azimuth: 0, elevation: 0, roll: 0 };
const _pcart = { lat: 0, lon: 0, height: 0 };
const _plocal = new Vector3();

/** Liefert die Geländehöhe in m (oder null) für Breite/Länge in Grad. */
export type GroundHeightFn = (lat: number, lon: number) => number | null;

interface BelowHit {
  point: Vector3;
  distance: number;
}

/**
 * Abstand zum Boden unter einem Punkt aus Mesh-Treffer und gemessener Höhe
 * (Auswahl siehe {@link chooseGroundHeight}). Abstände in m entlang `up`.
 */
export function pickGroundDistance(
  meshDistance: number | null,
  pointHeight: number,
  groundHeight: number | null,
  meshHasBuildings = true,
): number | null {
  const choice = chooseGroundHeight(
    meshDistance === null ? null : pointHeight - meshDistance,
    groundHeight,
    meshHasBuildings,
  );
  if (!choice) return null;
  return choice.fromMesh && meshDistance !== null ? meshDistance : pointHeight - choice.height;
}

/**
 * Globus-Kamera wie in Google Earth: `GlobeControls` aus 3d-tiles-renderer (Ziehen dreht die Erde,
 * rechte Maus/Strg neigt und dreht, Mausrad zoomt zum Cursor, Trägheit, Geländekollision)
 * plus „Fliege zu“.
 */
export class GlobeCamera {
  readonly controls: GlobeControls;
  private flight: { plan: FlightPlan; elapsed: number; resolve: () => void } | null = null;
  /** Filmische Kamerafahrt: liefert pro Frame die Pose, `null` beendet sie. */
  private script: ((dt: number) => CameraPose | null) | null = null;

  constructor(
    readonly camera: PerspectiveCamera,
    scene: Scene,
    private readonly globe: Object3D,
    domElement: HTMLElement,
    groundHeightAt: GroundHeightFn = () => null,
    meshHasBuildings: () => boolean = () => true,
  ) {
    this.controls = new GlobeControls(scene, camera, domElement);
    this.controls.setEllipsoid(WGS84_ELLIPSOID, globe);
    this.controls.enableDamping = true;
    // Nie unter die Oberfläche; Mindestabstand zum Gelände in Metern.
    this.controls.cameraRadius = 5;
    this.controls.minDistance = 25;
    this.patchGroundQuery(groundHeightAt, meshHasBuildings);
  }

  /**
   * GlobeControls hält die Kamera nur über dem gerenderten Mesh. Solange nur grobe Kacheln geladen
   * sind (langsames Netz), liegt das weit unter dem echten Gelände und die Kamera kann beim Neigen
   * in Berge eintauchen. Daher zusätzlich die gemessene Höhe berücksichtigen.
   */
  private patchGroundQuery(groundHeightAt: GroundHeightFn, meshHasBuildings: () => boolean): void {
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
      const dist = pickGroundDistance(
        hit?.distance ?? null,
        _pcart.height,
        ground,
        meshHasBuildings(),
      );
      if (dist === null || dist === hit?.distance) return hit;
      return { point: point.clone().addScaledVector(up, -dist), distance: dist };
    };
  }

  /**
   * Keine Geste und keine Trägheit aktiv: Nur dann wird der Ursprung verschoben, damit die
   * internen Zustände der Controls nicht mitten in einer Bewegung umgerechnet werden müssen.
   */
  get idle(): boolean {
    const c = this.controls as unknown as {
      state: number;
      dragInertia: Vector3;
      rotationInertia: { lengthSq(): number };
      globeInertiaFactor: number;
      zoomDelta: number;
    };
    return (
      c.state === 0 &&
      c.dragInertia.lengthSq() === 0 &&
      c.rotationInertia.lengthSq() === 0 &&
      c.globeInertiaFactor === 0 &&
      c.zoomDelta === 0
    );
  }

  /** Nach einer Ursprungsverschiebung: in Weltkoordinaten gespeicherte Punkte/Richtungen umrechnen. */
  applyOriginShift(d: Matrix4): void {
    const c = this.controls as unknown as Record<string, Vector3>;
    for (const key of ['pivotPoint', 'zoomPoint', 'rotationInertiaPivot']) c[key]?.applyMatrix4(d);
    for (const key of ['zoomDirection', 'dragInertia', 'up']) {
      const v = c[key];
      if (v && v.lengthSq() > 0) {
        const len = v.length();
        v.transformDirection(d).multiplyScalar(len);
      }
    }
  }

  get flying(): boolean {
    return this.flight !== null || this.script !== null;
  }

  /** Kamerafahrt starten (Mond-Absturz) bzw. mit `null` beenden; Eingaben ruhen solange. */
  setScript(script: ((dt: number) => CameraPose | null) | null): void {
    this.cancelFlight();
    this.script = script;
    this.controls.enabled = script === null;
    if (!script) this.controls.resetState();
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
    if (this.script) {
      const pose = this.script(dt);
      if (pose) {
        this.setPose(pose);
        this.controls.adjustCamera(this.camera);
        return;
      }
      this.setScript(null);
    }
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
    this.script = null;
    this.cancelFlight();
    this.controls.dispose();
  }
}
