import {
  CanvasTexture,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { store } from '../../core/store';
import { enuBasis } from '../../core/geo';
import type { GeoPoint } from '../../core/types';
import { flightPose, planFlight, type CameraPose } from '../../camera/flyTo';
import { t } from '../../ui/i18n';
import { EARTH_RADIUS_M } from '../../world/globeFx/overlay';
import type { Tool, WorldApi } from '../Tool';

/** Mondradius (m). */
export const MOON_RADIUS_M = 1_737_400;
/** Roche-Grenze Erde–Mond für einen flüssigen Körper (≈ 18 500 km): hier zerreißt er. */
export const ROCHE_M = 18_470_000;
/** Freier Fall aus der Mondbahn dauert real knapp 5 Tage (für den Zeitraffer-Zähler). */
export const FALL_DAYS = 4.8;

/** Ablauf in Sekunden Simulationszeit. */
export const MOON_CAMERA_IN_S = 4;
const APPROACH_START_S = 1;
export const MOON_APPROACH_S = 16;
/** Nach dem ersten Einschlag: Glut breitet sich aus, dann folgt das Reset-Angebot. */
export const MOON_AFTERMATH_S = 10;
/** Startabstand vom Erdmittelpunkt (m) und Winkel zur Einschlag-Senkrechten. */
const START_RHO_M = 30_000_000;
const START_THETA = (70 * Math.PI) / 180;
const SIDE_PSI = (20 * Math.PI) / 180;
/** Bruchstücke nach dem Zerreißen und ihr größter Rückstand auf der Bahn. */
const FRAGMENTS = 70;
const MAX_LAG = 0.2;
/** Kamera: Abstand über dem Einschlagort in der Totale bzw. nach dem Einschlag (m). */
const WIDE_HEIGHT_M = 45_000_000;
const CLOSE_HEIGHT_M = 30_000_000;

export type MoonPhase = 'approach' | 'breakup' | 'impact' | 'aftermath' | 'done';

/** Fortschritt des führenden Brockens auf der Bahn (0…1 + Rückstand der letzten Stücke). */
export function moonProgress(timeS: number): number {
  return Math.min(1 + MAX_LAG, Math.max(0, (timeS - APPROACH_START_S) / MOON_APPROACH_S));
}

/** Abstand vom Erdmittelpunkt (m) bei Fortschritt `s`: beschleunigt zum Ende hin. */
export function moonDistance(s: number): number {
  const k = Math.min(1, Math.max(0, s));
  return START_RHO_M + (EARTH_RADIUS_M - START_RHO_M) * k ** 1.6;
}

/** Fortschritt, bei dem der Mond die Roche-Grenze erreicht. */
export const ROCHE_PROGRESS =
  ((START_RHO_M - ROCHE_M) / (START_RHO_M - EARTH_RADIUS_M)) ** (1 / 1.6);

/** Zeitpunkt des ersten Einschlags (s). */
export const MOON_IMPACT_S = APPROACH_START_S + MOON_APPROACH_S;
/** Ab hier wird „Welt zurücksetzen“ angeboten (s). */
export const MOON_END_S = MOON_IMPACT_S + MOON_AFTERMATH_S;

/** Phase der Sequenz zum Zeitpunkt `timeS`. */
export function moonPhase(timeS: number): MoonPhase {
  if (timeS >= MOON_END_S) return 'done';
  const s = moonProgress(timeS);
  if (s < ROCHE_PROGRESS) return 'approach';
  if (s < 1) return 'breakup';
  if (timeS < MOON_IMPACT_S + 3) return 'impact';
  return 'aftermath';
}

/** Zeitraffer: Tag 1 bis 5 des Falls. */
export function moonDay(timeS: number): number {
  return 1 + Math.floor(FALL_DAYS * Math.min(0.999, moonProgress(timeS)));
}

/** Position (ECEF) auf der Spiralbahn zum Einschlagort; `basis` aus {@link enuBasis}. */
export function moonPosition(
  s: number,
  basis: { east: Vector3; north: Vector3; up: Vector3 },
  out = new Vector3(),
): Vector3 {
  const k = Math.min(1, Math.max(0, s));
  const rho = moonDistance(k);
  const theta = START_THETA * (1 - k);
  const side = Math.sin(theta);
  return out
    .copy(basis.up)
    .multiplyScalar(Math.cos(theta) * rho)
    .addScaledVector(basis.east, side * Math.cos(SIDE_PSI) * rho)
    .addScaledVector(basis.north, side * Math.sin(SIDE_PSI) * rho);
}

/** Prozedurale Mondoberfläche: Hochland, dunkle Maria und Krater (keine externe Datei). */
function moonTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.fillStyle = '#9a9690';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(70, 68, 66, ${0.35 + 0.3 * rnd()})`;
    g.beginPath();
    g.ellipse(rnd() * 512, 60 + rnd() * 140, 20 + rnd() * 60, 12 + rnd() * 35, rnd() * 3, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 512;
    const y = rnd() * 256;
    const r = 1.5 + rnd() ** 3 * 14;
    g.fillStyle = 'rgba(60, 58, 56, 0.45)';
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(205, 200, 192, 0.5)';
    g.lineWidth = Math.max(0.6, r * 0.25);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _axis = new Vector3();

interface Fragment {
  lag: number;
  offset: Vector3;
  size: number;
  spin: Vector3;
  landed: boolean;
}

/**
 * `moon-drop` (Spec 8, Stufe 5): Der Mond wird auf die Erde gelenkt. Rein filmische Sequenz mit
 * Zeitraffer und Kamerafahrt: Anflug auf einer Spiralbahn, Zerreißen an der Roche-Grenze,
 * Einschlag der Bruchstücke, die Kruste glüht, der Himmel wird dunkel. Am Ende bietet die UI
 * „Welt zurücksetzen“ an. SIMPLIFIED: keine echte Bahnmechanik, Größen und Zeiten stilisiert.
 */
export function createMoonDropTool(): Tool {
  const tt = t.tools['moon-drop'];
  return {
    id: 'moon-drop',
    name: tt.name,
    tier: 5,
    icon: 'moon',
    description: tt.description,
    params: [{ key: 'start', label: tt.start, type: 'action', default: false }],
    onAction(key, _params, env) {
      if (key !== 'start' || store.cinematic.value) return;
      startMoonDrop(env.world, env.focus());
    },
  };
}

/** Startet die Sequenz; das Ziel ist der Ort im Fokus (Blase bzw. unter der Kamera). */
export function startMoonDrop(world: WorldApi, target: GeoPoint): void {
  const fx = world.globeFx;
  const b = enuBasis(target);
  const basis = {
    east: new Vector3(b.east.x, b.east.y, b.east.z),
    north: new Vector3(b.north.x, b.north.y, b.north.z),
    up: new Vector3(b.up.x, b.up.y, b.up.z),
  };
  const root = fx.ecefGroup();
  const map = moonTexture();
  const material = new MeshLambertMaterial({ color: 0xffffff, map });
  const moon = new Mesh(new SphereGeometry(MOON_RADIUS_M, 64, 32), material);
  moon.raycast = () => undefined;
  root.add(moon);
  const fragGeo = new IcosahedronGeometry(1, 1);
  const frags = new InstancedMesh(fragGeo, material, FRAGMENTS);
  frags.raycast = () => undefined;
  frags.frustumCulled = false;
  frags.visible = false;
  root.add(frags);
  let seed = 11;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pieces: Fragment[] = Array.from({ length: FRAGMENTS }, (_, i) => ({
    lag: i === 0 ? 0 : MAX_LAG * rnd() ** 0.7,
    offset: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2 * MOON_RADIUS_M),
    size: i === 0 ? 0.45 * MOON_RADIUS_M : MOON_RADIUS_M * (0.08 + 0.3 * rnd() ** 2),
    spin: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
    landed: false,
  }));
  fx.farM = 2e8;

  // Kamera: erst in die Totale über dem Einschlagort, dann ruhig halten, nach dem Einschlag näher
  world.rig.setMode('globe');
  const from = world.globeCamera.getPose();
  const wide: CameraPose = { ...target, height: WIDE_HEIGHT_M, heading: 0, pitch: -90 };
  const plan = planFlight(from, wide);
  let time = 0;
  let impacted = false;
  let caption = '';
  world.globeCamera.setScript(() => {
    if (time >= MOON_END_S) return null;
    if (time < MOON_CAMERA_IN_S) return flightPose(plan, time / MOON_CAMERA_IN_S);
    const after = Math.max(0, time - MOON_IMPACT_S) / 6;
    const k = Math.min(1, after);
    return {
      ...wide,
      height: WIDE_HEIGHT_M + (CLOSE_HEIGHT_M - WIDE_HEIGHT_M) * k * k * (3 - 2 * k),
    };
  });

  const setCaption = (key: string, text: string, detail?: string): void => {
    if (caption === key && !detail) return;
    caption = key;
    store.cinematic.value = { caption: text, detail };
  };
  const tt = t.tools['moon-drop'];

  fx.addTask((dt) => {
    time += dt;
    const s = moonProgress(time);
    const phase = moonPhase(time);
    if (phase === 'approach') {
      setCaption(
        'approach',
        tt.captions.approach,
        tt.captions.day.replace('{day}', String(moonDay(time))).replace('{of}', '5'),
      );
      moonPosition(s, basis, moon.position);
      // Gezeitenkräfte strecken den Mond kurz vor der Roche-Grenze zur Erde hin
      const stretch = 1 + 0.35 * Math.max(0, (s - ROCHE_PROGRESS * 0.75) / (ROCHE_PROGRESS * 0.25));
      _axis.copy(moon.position).normalize();
      moon.quaternion.setFromUnitVectors(_s.set(0, 1, 0), _axis);
      moon.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
      return false;
    }
    if (moon.visible && phase !== 'done') {
      moon.visible = false;
      frags.visible = true;
    }
    if (phase === 'breakup') {
      setCaption(
        'breakup',
        tt.captions.breakup,
        tt.captions.day.replace('{day}', String(moonDay(time))).replace('{of}', '5'),
      );
    }
    // Bruchstücke folgen der Bahn mit Rückstand und driften auseinander
    const spread = Math.min(1, Math.max(0, (s - ROCHE_PROGRESS) / (1 - ROCHE_PROGRESS)));
    for (let i = 0; i < FRAGMENTS; i++) {
      const f = pieces[i]!;
      const si = s - f.lag;
      if (!f.landed && si >= 1) {
        f.landed = true;
        if (i > 0 && i % 6 === 0) fx.add({ geo: target, flash: { seconds: 1.2 } });
      }
      moonPosition(si, basis, _p).addScaledVector(
        f.offset,
        0.4 + 2.5 * spread * (1 - Math.min(1, si)),
      );
      _q.setFromAxisAngle(f.spin, time * 0.6 + i);
      _s.setScalar(f.landed || si < 0 ? 0 : f.size);
      _m.compose(_p, _q, _s);
      frags.setMatrixAt(i, _m);
    }
    frags.instanceMatrix.needsUpdate = true;
    if (!impacted && s >= 1) {
      impacted = true;
      setCaption('impact', tt.captions.impact);
      fx.add({
        geo: target,
        flash: { seconds: 5 },
        shock: { maxM: Math.PI * EARTH_RADIUS_M * 0.98, speedMs: 1_500_000 },
        molten: { maxM: Math.PI * EARTH_RADIUS_M, growS: 14, alpha: 0.9 },
        dust: { maxM: Math.PI * EARTH_RADIUS_M, growS: 20, alpha: 0.5 },
        crater: { radiusM: 2_500_000 },
      });
      fx.darken(1);
      world.audio.explosion(2_000_000, 1e15);
      const physics = world.physics;
      if (physics?.frame) {
        world.destruction?.vaporize(new Vector3(), physics.radius * 2);
        physics.clearBodies();
      }
    }
    if (phase === 'aftermath') setCaption('aftermath', tt.captions.aftermath);
    if (phase !== 'done') return false;
    // Ende: Brocken weg, Kamera frei, „Welt zurücksetzen“ anbieten
    frags.visible = false;
    fx.farM = 0;
    store.cinematic.value = {
      caption: tt.captions.end,
      detail: tt.captions.endDetail,
      offerReset: true,
    };
    return true;
  });
}
