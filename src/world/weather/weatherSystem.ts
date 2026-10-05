import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FogExp2,
  Line,
  LineBasicMaterial,
  type Scene,
  type Vector3,
} from 'three';
import type { WeatherState } from '../../core/types';
import { CLOUD_BASE_AGL_M, CloudDeck } from './clouds';
import { PrecipitationVolume } from './precipitation';
import { DEFAULT_WEATHER, windVector } from './weather';

/** Sichtweite je Voreinstellung (m) bei voller Stärke. */
export function visibilityM(w: WeatherState): number {
  switch (w.preset) {
    case 'fog':
      return 220;
    case 'snow':
      return 2_500 - 1_700 * w.intensity;
    case 'storm':
      return 3_000;
    case 'rain':
      return 9_000 - 6_000 * w.intensity;
    case 'cloudy':
      return 25_000;
    default:
      // Klarer Tag: nur leichter Dunst zum Horizont (Spec 6.2)
      return 80_000;
  }
}

/** Dichte für `FogExp2`: bei der Sichtweite sind noch rund 2 % Kontrast übrig. */
export function fogDensity(visibility: number): number {
  return 1.98 / Math.max(1, visibility);
}

/**
 * Abdunkelung des Sonnenlichts (Faktor 0…1) durch Wolken und Niederschlag (SIMPLIFIED: ohne
 * Wolkenschatten, gleichmäßig).
 */
export function sunFactor(w: WeatherState): number {
  const precip = w.precipitation === 'none' ? 0 : 0.15 + 0.15 * w.intensity;
  const fog = w.preset === 'fog' ? 0.35 : 0;
  return Math.max(0.12, 1 - 0.65 * w.cloudCover ** 1.5 - precip - fog);
}

const GREY = new Color(0x9aa1aa);
const FOG_WHITE = new Color(0xc9ced4);
const STORM = new Color(0x4a5058);
/** Mittlerer Abstand zwischen Blitzen bei Gewitter (s). */
const LIGHTNING_EVERY_S = 6;

export interface WeatherFrame {
  dt: number;
  camera: Vector3;
  /** Kamerahöhe über Grund (m) und Geländehöhe unter der Kamera im Welt-y. */
  cameraAgl: number;
  groundY: number;
  /** Sonnenhöhe: Skalarprodukt Sonnenrichtung · oben. */
  sunUp: number;
}

/**
 * Wetter in der Szene (Spec 7.5): Wolkendecke, Regen/Schnee um die Kamera, Nebel, Blitze bei
 * Gewitter. Liefert Faktoren für Licht und Himmel; Wind geht an Partikel und Rauch.
 */
export class WeatherSystem {
  private state: WeatherState = DEFAULT_WEATHER;
  readonly clouds = new CloudDeck();
  readonly precipitation: PrecipitationVolume;
  private readonly fog = new FogExp2(0xc9ced4, 0);
  private readonly bolt: Line<BufferGeometry, LineBasicMaterial>;
  private boltLife = 0;
  private nextBolt = 3;
  /** 0…1, klingt ab: Aufhellung durch einen Blitz. */
  flash = 0;
  /** Zufallsquelle (deterministisch austauschbar). */
  random: () => number = Math.random;
  /** Blitz mit Abstand zur Kamera (m), für den Donner. */
  onLightning: ((distanceM: number) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    precipitationCapacity = 9_000,
  ) {
    this.precipitation = new PrecipitationVolume(precipitationCapacity);
    scene.add(this.clouds.mesh, this.precipitation.mesh);
    const boltGeo = new BufferGeometry();
    boltGeo.setAttribute('position', new BufferAttribute(new Float32Array(3 * 24), 3));
    this.bolt = new Line(
      boltGeo,
      new LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 1, fog: false }),
    );
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.bolt.renderOrder = 7;
    scene.add(this.bolt);
  }

  get current(): WeatherState {
    return this.state;
  }

  set(state: WeatherState): void {
    this.state = state;
  }

  /** Wind in m/s im Welt-Frame (x = Ost, z = −Nord). */
  wind(): { x: number; z: number } {
    return windVector(this.state);
  }

  /** Ursprung verschoben (Welt-Delta eines festen Bodenpunkts). */
  shiftOrigin(dx: number, dz: number): void {
    this.clouds.shift(-dx, -dz);
  }

  /** Lichtfaktor für die Sonne (0…1) und Aufhellung durch Blitze. */
  get sunFactor(): number {
    return sunFactor(this.state);
  }

  /** Himmels- und Nebelfarbe: Grundfarbe zu Grau je nach Bewölkung und Nebel. */
  tintSky(sky: Color, sunUp: number): Color {
    const w = this.state;
    const k = Math.min(1, w.cloudCover * 0.75 + (w.precipitation !== 'none' ? 0.2 : 0));
    const day = Math.min(1, Math.max(0, (sunUp + 0.1) / 0.35));
    const target = w.preset === 'storm' ? STORM : w.preset === 'fog' ? FOG_WHITE : GREY;
    sky.lerp(_tint.copy(target).multiplyScalar(0.15 + 0.85 * day), k);
    if (w.preset === 'fog') sky.lerp(_tint.copy(FOG_WHITE).multiplyScalar(0.1 + 0.9 * day), 0.7);
    if (this.flash > 0) sky.lerp(_tint.setRGB(0.85, 0.88, 1), this.flash * 0.8);
    return sky;
  }

  update(f: WeatherFrame, sky: Color): void {
    const w = this.state;
    const wind = windVector(w);
    const cloudBaseY = f.groundY + CLOUD_BASE_AGL_M;
    const dark = w.precipitation !== 'none' ? 0.5 + 0.4 * w.intensity : 0;
    this.clouds.update(
      f.dt,
      f.camera,
      cloudBaseY,
      w.cloudCover,
      dark,
      wind.x,
      wind.z,
      f.sunUp,
      f.cameraAgl,
    );
    const under = f.cameraAgl < CLOUD_BASE_AGL_M + 200;
    this.precipitation.update(f.dt, f.camera, w.precipitation, w.intensity, wind.x, wind.z, under);

    // Nebel nur in Bodennähe: aus dem All bleibt der Globus klar
    const vis = visibilityM(w);
    const layer = w.preset === 'fog' ? 400 : CLOUD_BASE_AGL_M;
    const fade = 1 - Math.min(1, Math.max(0, (f.cameraAgl - layer) / (layer * 3)));
    const density = fogDensity(vis) * fade;
    if (density > 1e-7) {
      this.fog.density = density;
      this.fog.color.copy(sky);
      this.scene.fog = this.fog;
    } else if (this.scene.fog === this.fog) {
      this.scene.fog = null;
    }

    this.updateLightning(f);
  }

  private updateLightning(f: WeatherFrame): void {
    this.flash = Math.max(0, this.flash - f.dt * 6);
    if (this.boltLife > 0) {
      this.boltLife -= f.dt;
      this.bolt.material.opacity = Math.max(0, Math.min(1, this.boltLife / 0.12));
      if (this.boltLife <= 0) this.bolt.visible = false;
    }
    if (this.state.preset !== 'storm' || f.dt <= 0) return;
    this.nextBolt -= f.dt;
    if (this.nextBolt > 0) return;
    this.nextBolt = LIGHTNING_EVERY_S * (0.3 + 1.4 * this.random());
    this.strike(f);
  }

  /** Ein Blitz: gezackte Linie von der Wolke zum Boden, 0,5 bis 4 km entfernt. */
  private strike(f: WeatherFrame): void {
    const a = this.random() * Math.PI * 2;
    const d = 500 + this.random() * 3_500;
    const x0 = f.camera.x + Math.cos(a) * d;
    const z0 = f.camera.z + Math.sin(a) * d;
    const top = f.groundY + CLOUD_BASE_AGL_M;
    const pos = this.bolt.geometry.getAttribute('position') as BufferAttribute;
    const n = pos.count;
    let x = x0;
    let z = z0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      pos.setXYZ(i, x, top + (f.groundY - top) * t, z);
      x += (this.random() - 0.5) * 70;
      z += (this.random() - 0.5) * 70;
    }
    pos.needsUpdate = true;
    this.bolt.geometry.computeBoundingSphere();
    this.bolt.visible = true;
    this.bolt.material.opacity = 1;
    this.boltLife = 0.18;
    this.flash = 1;
    this.onLightning?.(d);
  }

  dispose(): void {
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.clouds.dispose();
    this.precipitation.dispose();
    this.bolt.removeFromParent();
    this.bolt.geometry.dispose();
    this.bolt.material.dispose();
  }
}

const _tint = new Color();
