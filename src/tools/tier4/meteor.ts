import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  Vector3,
} from 'three';
import { TNT_J_PER_KG } from '../../core/constants';
import { impactCrater, meteorEnergyJ, tntKgFromJoule, vaporizeRadius } from '../../physics/impact';
import { t } from '../../ui/i18n';
import { formatEnergy, formatTnt } from '../explosions';
import { num, type Tool, type ToolContext } from '../Tool';

/** Anflug in der Darstellung (s): real dauert er unter einer Sekunde (SIMPLIFIED, ADR-023). */
export const METEOR_APPROACH_S = 4.5;
/** Leuchtspur beginnt in dieser Höhe über dem Ziel (m). */
export const METEOR_START_HEIGHT_M = 12_000;
/** So lange bleibt die Kamera nach dem Einschlag auf der Einschlagstelle (s). */
const IMPACT_HOLD_S = 6;
/** Höchstens so viele Gebäude außerhalb des Kraters brechen in Stücke (Rechenzeit). */
const MAX_FRACTURED = 40;

/** Einheitsvektor der Flugrichtung (Blasen-Frame): Azimut von Nord im Uhrzeigersinn, Winkel zur Horizontalen. */
export function entryDirection(azimuthRad: number, angleDeg: number, out = new Vector3()): Vector3 {
  const el = (Math.max(5, Math.min(90, angleDeg)) * Math.PI) / 180;
  const h = Math.cos(el);
  // Flug nach unten in Richtung Azimut: Ost = sin, Nord = cos (z = −Nord)
  return out.set(Math.sin(azimuthRad) * h, -Math.sin(el), -Math.cos(azimuthRad) * h);
}

function createMeteorVisual(diameterM: number): Group {
  const g = new Group();
  g.name = 'meteor';
  // Mindestgröße, damit auch ein 1-m-Stein aus der Ferne als Feuerkugel sichtbar ist
  const r = Math.max(3, diameterM * 0.6);
  const core = new Mesh(
    new SphereGeometry(r, 16, 12),
    new MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.95 }),
  );
  const glow = new Mesh(
    new SphereGeometry(r * 2.2, 16, 12),
    new MeshBasicMaterial({
      color: 0xff8a2a,
      transparent: true,
      opacity: 0.45,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  // Plasmaschweif hinter dem Kopf (Spitze nach hinten = +z im eigenen Frame)
  const tail = new Mesh(
    new ConeGeometry(r * 1.6, r * 10, 16, 1, true),
    new MeshBasicMaterial({
      color: 0xffa040,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  tail.rotation.x = Math.PI / 2;
  // Erst hinter der Feuerkugel, sonst umschließt der Schweif sie wie ein Trichter
  tail.position.z = r * 7;
  const light = new PointLight(0xffb070, 4e6 * Math.max(1, r / 6), 0, 2);
  g.add(core, glow, tail, light);
  return g;
}

function disposeVisual(g: Group): void {
  g.removeFromParent();
  g.traverse((o) => {
    if (o instanceof Mesh) {
      const mesh = o as Mesh<SphereGeometry, MeshBasicMaterial>;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
}

const _fwd = new Vector3(0, 0, -1);
const _trailDir = new Vector3();

/**
 * `meteor` (Spec 8): Durchmesser 1 bis 100 m, 11 bis 72 km/s, Eintrittswinkel 15 bis 90°.
 * E = ½·m·v² (Steinmeteor, 3 000 kg/m³) → TNT. Leuchtspur, Krater nach Collins et al., Druckwelle.
 * Die Verfolgerkamera hängt sich an (abschaltbar).
 */
export function createMeteorTool(): Tool {
  const tt = t.tools.meteor;
  return {
    id: 'meteor',
    name: tt.name,
    tier: 4,
    icon: 'meteor',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'diameter',
        label: tt.diameter,
        type: 'number',
        min: 1,
        max: 100,
        step: 1,
        unit: 'm',
        default: 20,
      },
      {
        key: 'speed',
        label: tt.speed,
        type: 'number',
        min: 11,
        max: 72,
        step: 1,
        unit: 'km/s',
        default: 20,
      },
      {
        key: 'angle',
        label: tt.angle,
        type: 'number',
        min: 15,
        max: 90,
        step: 5,
        unit: '°',
        default: 45,
      },
      { key: 'follow', label: tt.follow, type: 'boolean', default: true },
    ],
    onPointerDown(hit, ctx, params) {
      launchMeteor(ctx, hit.local.clone(), {
        diameterM: num(params.diameter, 20),
        speedKms: num(params.speed, 20),
        angleDeg: num(params.angle, 45),
        follow: params.follow !== false,
      });
    },
  };
}

export interface MeteorOptions {
  diameterM: number;
  speedKms: number;
  angleDeg: number;
  follow: boolean;
}

/** Meteor auf `target` (Blasen-Frame) schicken. Liefert die Energie in kg TNT. */
export function launchMeteor(ctx: ToolContext, target: Vector3, o: MeteorOptions): number {
  const physics = ctx.physics;
  target.y = physics.groundY(target.x, target.z);
  const energy = meteorEnergyJ(o.diameterM, o.speedKms);
  const tnt = tntKgFromJoule(energy);
  const crater = impactCrater(o.diameterM, o.speedKms, o.angleDeg);
  // Anflug von schräg vorn-seitlich der Kamera, damit die Spur quer durchs Bild zieht
  const cam = physics.worldToBubble(ctx.view.position);
  const toTarget = Math.atan2(target.x - cam.x, -(target.z - cam.z));
  const azimuth = toTarget + (Math.PI / 180) * 70;
  const dir = entryDirection(azimuth, o.angleDeg);
  const path = METEOR_START_HEIGHT_M / -dir.y;
  const start = target.clone().addScaledVector(dir, -path);

  const visual = createMeteorVisual(o.diameterM);
  visual.position.copy(start);
  // Ausrichtung im Blasen-Frame: lokale −z zeigt in Flugrichtung
  visual.quaternion.setFromUnitVectors(_fwd, dir);
  physics.group.add(visual);
  visual.updateMatrixWorld(true);
  if (o.follow) {
    // Hinter dem Plasmaschweif bleiben, sonst steckt die Kamera in der Feuerkugel
    ctx.camera.follow.setTarget(visual, {
      distance: Math.max(180, 14 * Math.max(3, o.diameterM * 0.6)),
      height: Math.max(50, 4 * o.diameterM),
    });
    ctx.camera.setMode('follow');
  }
  ctx.toast(
    'info',
    t.tools.meteor.incoming
      .replace('{tnt}', formatTnt(tnt))
      .replace('{energy}', formatEnergy(tnt * TNT_J_PER_KG)),
  );

  const frame = physics.frame;
  const effects = ctx.effects;
  const size = Math.max(3, o.diameterM * 0.6);
  let time = 0;
  let impacted = false;
  let trailAcc = 0;
  ctx.addTask((dt) => {
    if (physics.frame !== frame) {
      disposeVisual(visual);
      return true;
    }
    time += dt;
    if (!impacted) {
      const k = Math.min(1, time / METEOR_APPROACH_S);
      // Leicht beschleunigt (Schwere), endet genau am Ziel
      const s = k * k * 0.3 + k * 0.7;
      visual.position.copy(start).addScaledVector(dir, path * s);
      trailAcc += dt;
      while (trailAcc > 1 / 30) {
        trailAcc -= 1 / 30;
        _trailDir.copy(dir).multiplyScalar(-1);
        effects.emit('glow', visual.position, _trailDir, effects.range(5, 30), {
          life: effects.range(0.4, 0.9),
          size0: size * 3,
          size1: size * 1.2,
          r: 1,
          g: effects.range(0.55, 0.8),
          b: 0.3,
          a: 0.85,
          endTint: 0.4,
          drag: 2,
        });
        effects.emit('smoke', visual.position, _trailDir, effects.range(2, 8), {
          life: effects.range(10, 20),
          size0: size * 2,
          size1: size * 7,
          r: 0.55,
          g: 0.52,
          b: 0.5,
          a: 0.45,
          drag: 0.5,
          wind: 1,
        });
      }
      if (k < 1) return false;
      impacted = true;
      time = 0;
      visual.position.copy(target);
      for (const c of visual.children) c.visible = false;
      ctx.explosions.detonate(target.clone(), tnt, {
        burstHeightM: 0,
        source: 'meteor',
        crater,
        vaporizeRadiusM: vaporizeRadius(crater, tnt),
        maxBuildings: MAX_FRACTURED,
      });
      ctx.events.emit('impact', {
        posLocal: { x: target.x, y: target.y, z: target.z },
        energyJ: energy,
        source: 'meteor',
      });
      if (o.follow) {
        // Weit zurück und hoch, damit der Krater ins Bild passt
        const back = Math.max(250, crater.radiusM * 3.2);
        ctx.camera.follow.setTarget(visual, { distance: back, height: back * 0.6 });
      }
      return false;
    }
    if (time < IMPACT_HOLD_S) return false;
    disposeVisual(visual);
    return true;
  });
  return tnt;
}
