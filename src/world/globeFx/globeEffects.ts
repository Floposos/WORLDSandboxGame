import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { enuBasis, LocalFrame } from '../../core/geo';
import type { GeoPoint } from '../../core/types';
import type { MushroomSize, YieldRadii } from '../../physics/nuclear';
import { MushroomCloud } from './mushroom';
import { arcAngle, emptySlot, GlobeOverlay, overlayFade, type OverlaySlot } from './overlay';

/** Beschreibung eines Ereignisses auf der Hülle (alle Längen in m auf der Erdoberfläche). */
export interface GlobeEventSpec {
  geo: GeoPoint;
  /** Wirkungsringe (Mega-Bombe), sichtbar für `holdS` Sekunden. */
  rings?: YieldRadii & { holdS?: number };
  /** Druckwelle als wandernder Ring bis `maxM`. */
  shock?: { maxM: number; speedMs: number };
  /** Lichtblitz, klingt in `seconds` ab. */
  flash?: { seconds: number };
  /** Staubdecke, wächst in `growS` auf `maxM`; ohne `holdS` bleibt sie bis zum Zurücksetzen. */
  dust?: { maxM: number; growS: number; alpha: number; holdS?: number };
  /** Krater (bleibt bis zum Zurücksetzen). */
  crater?: { radiusM: number };
  /** Glut bzw. geschmolzene Kruste, wächst in `growS` auf `maxM` (bleibt). */
  molten?: { maxM: number; growS: number; alpha: number };
}

const RINGS_IN_S = 0.3;
const RINGS_FADE_S = 12;
const DEFAULT_RINGS_HOLD_S = 90;
const DUST_FADE_S = 30;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Wachstum, das zum Ende abbremst (0…1). */
const grow = (age: number, seconds: number): number =>
  seconds <= 0 ? 1 : 1 - (1 - Math.min(1, Math.max(0, age / seconds))) ** 2;

/**
 * Zustand eines Ereignisses nach `age` Sekunden als Eintrag der Hülle. Liefert false, wenn nichts
 * mehr zu sehen ist (dann fällt das Ereignis weg).
 */
export function eventSlot(spec: GlobeEventSpec, age: number, out: OverlaySlot): boolean {
  let alive = false;
  out.fireball = out.heavy = out.light = out.ringsAlpha = 0;
  out.shock = out.shockAlpha = out.dust = out.dustAlpha = 0;
  out.crater = out.molten = out.moltenAlpha = out.flash = 0;
  if (spec.flash) {
    const k = Math.max(0, 1 - age / spec.flash.seconds);
    out.flash = k * k;
    alive ||= k > 0;
  }
  if (spec.rings) {
    const hold = spec.rings.holdS ?? DEFAULT_RINGS_HOLD_S;
    const a = smooth(0, RINGS_IN_S, age) * (1 - smooth(hold, hold + RINGS_FADE_S, age));
    out.fireball = arcAngle(spec.rings.fireballM);
    out.heavy = arcAngle(spec.rings.heavyM);
    out.light = arcAngle(spec.rings.lightM);
    out.ringsAlpha = 0.9 * a;
    alive ||= age < hold + RINGS_FADE_S;
  }
  if (spec.shock) {
    const r = Math.min(spec.shock.maxM, spec.shock.speedMs * age);
    const k = r / Math.max(1, spec.shock.maxM);
    out.shock = arcAngle(r);
    out.shockAlpha = 0.95 * (1 - smooth(0.7, 1, k)) * smooth(0, 0.05, k);
    alive ||= k < 1;
  }
  if (spec.dust) {
    const d = spec.dust;
    const fade = d.holdS === undefined ? 1 : 1 - smooth(d.holdS, d.holdS + DUST_FADE_S, age);
    out.dust = arcAngle(d.maxM * grow(age, d.growS));
    out.dustAlpha = d.alpha * smooth(0, 2, age) * fade;
    alive ||= d.holdS === undefined || age < d.holdS + DUST_FADE_S;
  }
  if (spec.crater) {
    out.crater = arcAngle(spec.crater.radiusM);
    alive = true;
  }
  if (spec.molten) {
    out.molten = arcAngle(spec.molten.maxM * grow(age, spec.molten.growS));
    out.moltenAlpha = spec.molten.alpha * smooth(0, 1, age);
    alive = true;
  }
  return alive;
}

/** Geodätische Normale (ECEF, normiert) eines Ortes. */
export function geoNormal(geo: GeoPoint, out = new Vector3()): Vector3 {
  const { up } = enuBasis(geo);
  return out.set(up.x, up.y, up.z);
}

interface LiveEvent {
  spec: GlobeEventSpec;
  age: number;
  slot: OverlaySlot;
}

/** Ab dieser Kamerahöhe übernimmt die Hülle, darunter zeigen flache Ringe am Boden die Wirkung. */
const LOCAL_RING_HEIGHT_M = 25;

/**
 * Globale Effekte der Stufe 5 (Spec 8): Hülle mit Ringen, Krater, Staub und Glut, Pilzwolken und
 * Objekte im ENU-Frame eines Ortes, Verdunkelung des Himmels. Alles hängt am Globus (ECEF), nicht
 * an der Simulationsblase, und bleibt bis „Welt zurücksetzen“ bzw. bis es verweht ist.
 */
export class GlobeEffects {
  readonly overlay: GlobeOverlay;
  /** Richtung zur Sonne im Welt-Frame (setzt die Engine pro Frame). */
  readonly sunDir: Vector3;
  private readonly events: LiveEvent[] = [];
  private readonly anchors: Group[] = [];
  private readonly mushrooms: MushroomCloud[] = [];
  private tasks: ((dt: number) => boolean)[] = [];
  private readonly slots: OverlaySlot[] = [];
  /** Verdunkelung des Himmels 0…1 (folgt dem Ziel weich). */
  gloom = 0;
  private gloomTarget = 0;
  private time = 0;
  /** Kamerahöhe über dem Ellipsoid (m), aktualisiert in {@link update}. */
  cameraHeight = 0;
  /** Nötige Fernebene der Kamera (m), z. B. für den Mond; 0 = Standard. */
  farM = 0;

  constructor(private readonly globe: Object3D) {
    this.overlay = new GlobeOverlay(globe);
    this.sunDir = this.overlay.sunDirection;
  }

  /** Neues Ereignis auf der Hülle. */
  add(spec: GlobeEventSpec): void {
    const slot = emptySlot();
    geoNormal(spec.geo, slot.normal);
    this.events.push({ spec, age: 0, slot });
  }

  /** Gruppe im lokalen Frame (x = Ost, y = oben, z = −Nord) am Ort `geo`, am Globus befestigt. */
  anchor(geo: GeoPoint): Group {
    const g = new Group();
    g.matrixAutoUpdate = false;
    g.matrix.fromArray(new LocalFrame(geo).ecefToLocalMatrix()).invert();
    this.globe.add(g);
    g.updateMatrixWorld(true);
    this.anchors.push(g);
    return g;
  }

  /** Gruppe direkt im ECEF-Frame des Globus (Mond, Bahnen um die Erde). */
  ecefGroup(): Group {
    const g = new Group();
    this.globe.add(g);
    this.anchors.push(g);
    return g;
  }

  /** Pilzwolke am Ort (Boden in `geo.height`). */
  mushroom(geo: GeoPoint, size: MushroomSize): MushroomCloud {
    const cloud = new MushroomCloud(size, this.sunDir);
    const g = this.anchor(geo);
    g.add(cloud.group);
    cloud.setUp(geoNormal(geo).transformDirection(this.globe.matrixWorld));
    this.mushrooms.push(cloud);
    return cloud;
  }

  /**
   * Wirkungsringe flach am Boden (für Kameras in Bodennähe, wo die Hülle ausgeblendet ist) und
   * eine wandernde Druckwelle. SIMPLIFIED: eben, ohne Erdkrümmung und Geländefolge.
   */
  groundRings(geo: GeoPoint, radii: YieldRadii, shockSpeedMs: number, holdS: number): void {
    const g = this.anchor(geo);
    const make = (
      r: number,
      color: number,
      width: number,
    ): Mesh<RingGeometry, MeshBasicMaterial> => {
      const w = Math.min(0.5, Math.max(width, 6 / Math.max(1, r)));
      const m = new Mesh(
        new RingGeometry(1 - w, 1, 160).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      m.scale.setScalar(r);
      m.position.y = LOCAL_RING_HEIGHT_M;
      m.raycast = () => undefined;
      m.renderOrder = 12;
      g.add(m);
      return m;
    };
    const rings = [
      make(radii.fireballM, 0xffe08a, 0.04),
      make(radii.heavyM, 0xf03a2a, 0.02),
      make(radii.lightM, 0xffa030, 0.015),
    ];
    const shock = make(1, 0xeef4ff, 0.06);
    let age = 0;
    this.addTask((dt) => {
      age += dt;
      const local = 1 - overlayFade(this.cameraHeight);
      const a =
        0.85 * local * smooth(0, RINGS_IN_S, age) * (1 - smooth(holdS, holdS + RINGS_FADE_S, age));
      for (const m of rings) m.material.opacity = a;
      const r = Math.min(radii.lightM * 1.6, shockSpeedMs * age);
      shock.scale.setScalar(Math.max(1, r));
      shock.material.opacity = 0.9 * local * (1 - smooth(0.7, 1, r / (radii.lightM * 1.6)));
      if (age < holdS + RINGS_FADE_S) return false;
      for (const m of [...rings, shock]) {
        m.geometry.dispose();
        m.material.dispose();
      }
      this.removeAnchor(g);
      return true;
    });
  }

  /** Aufgabe pro Frame mit Simulationszeit; true beendet sie. */
  addTask(task: (dt: number) => boolean): void {
    this.tasks.push(task);
  }

  /** Himmel mindestens bis `target` (0…1) verdunkeln. */
  darken(target: number): void {
    this.gloomTarget = Math.max(this.gloomTarget, Math.min(1, Math.max(0, target)));
  }

  /** Vergangene Simulationszeit der Globus-Effekte (s). */
  get elapsed(): number {
    return this.time;
  }

  /** Läuft etwas, das Zeit braucht oder zu sehen ist? */
  get active(): boolean {
    return (
      this.events.length > 0 ||
      this.tasks.length > 0 ||
      this.mushrooms.length > 0 ||
      this.gloom > 0.001
    );
  }

  removeAnchor(g: Group): void {
    g.removeFromParent();
    const i = this.anchors.indexOf(g);
    if (i >= 0) this.anchors.splice(i, 1);
  }

  /** `dt` Simulationszeit (Pause hält alles an), Kamerahöhe über dem Ellipsoid. */
  update(dt: number, cameraHeightM: number): void {
    this.cameraHeight = cameraHeightM;
    this.time += dt;
    // Verdunkelung zieht in rund 20 s auf
    this.gloom += (this.gloomTarget - this.gloom) * Math.min(1, dt / 6);
    for (let i = 0; i < this.tasks.length; i++) {
      if (this.tasks[i]!(dt)) this.tasks.splice(i--, 1);
    }
    for (let i = this.mushrooms.length - 1; i >= 0; i--) {
      const m = this.mushrooms[i]!;
      if (m.update(dt)) continue;
      const g = this.anchors.find((x) => x === m.group.parent);
      m.dispose();
      if (g) this.removeAnchor(g);
      this.mushrooms.splice(i, 1);
    }
    this.slots.length = 0;
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]!;
      e.age += dt;
      if (eventSlot(e.spec, e.age, e.slot)) this.slots.push(e.slot);
      else this.events.splice(i--, 1);
    }
    this.overlay.update(this.slots, this.gloom * 0.75, overlayFade(cameraHeightM), this.time);
  }

  /** Alles entfernen („Welt zurücksetzen“). */
  clear(): void {
    this.events.length = 0;
    this.tasks = [];
    for (const m of this.mushrooms) m.dispose();
    this.mushrooms.length = 0;
    for (const g of [...this.anchors]) {
      g.traverse((o) => {
        if (o instanceof Mesh) {
          const mesh = o as Mesh<RingGeometry, MeshBasicMaterial>;
          mesh.geometry.dispose();
          mesh.material.map?.dispose();
          mesh.material.dispose();
        }
      });
      this.removeAnchor(g);
    }
    this.gloom = 0;
    this.gloomTarget = 0;
    this.farM = 0;
    this.overlay.update([], 0, 0, this.time);
  }

  dispose(): void {
    this.clear();
    this.overlay.dispose();
  }
}
