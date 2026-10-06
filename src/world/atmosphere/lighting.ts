import { AmbientLight, Color, DirectionalLight, Vector3, type Object3D, type Scene } from 'three';
import { sunDirectionEcef } from './sun';

const _dir = new Vector3();

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Zusätzliches Umgebungslicht in Bodennähe bei Tag (flache Sonne wirkt sonst matt). */
export const NEAR_DAY_BOOST = 1.1;
/** Zusätzliches Umgebungslicht in Bodennähe bei Nacht: die Oberfläche bleibt lesbar. */
export const NEAR_NIGHT_BOOST = 1.7;

/**
 * Aufhellung beim Hineinzoomen (Befund Florian, 2026-10-06): Aus dem All bleibt die Nachtseite
 * dunkel, unter ≈ 200 km wird das Umgebungslicht angehoben, unter 30 km voll. Nachts stärker
 * (wie ein Restlicht-Modus), tagsüber leicht gegen die matte, flache Oktobersonne.
 * SIMPLIFIED: kein echtes Mondlicht, keine Stadtbeleuchtung.
 * `sunUp` ist der Sinus der Sonnenhöhe am Kameraort.
 */
export function nearAmbientBoost(heightM: number, sunUp: number): number {
  const near = 1 - smooth(30_000, 200_000, heightM);
  return near * (NEAR_DAY_BOOST + (NEAR_NIGHT_BOOST - NEAR_DAY_BOOST) * nightFactor(sunUp));
}

/** 0 am Tag, 1 in der Nacht (weicher Übergang in der Dämmerung). */
export const nightFactor = (sunUp: number): number => 1 - smooth(-0.05, 0.25, sunUp);

const BOOST_DAY = new Color(0xe4eaff);
/** Nachts leicht blau (Mondlicht-Anmutung), damit die Nacht auch in Bodennähe erkennbar bleibt. */
const BOOST_NIGHT = new Color(0x9fb4ff);

/** Farbe der Aufhellung nach Tageszeit. */
export function boostColor(sunUp: number, out: Color): Color {
  return out.lerpColors(BOOST_DAY, BOOST_NIGHT, nightFactor(sunUp));
}

/**
 * Sonnenlicht nach echtem Datum und Uhrzeit (NOAA, lokal berechnet) plus schwaches Umgebungslicht.
 * Das Umgebungslicht hält die Nachtseite erkennbar (Befund M1-Test: abends wirkte alles schwarz).
 */
export class SunLighting {
  readonly sun = new DirectionalLight(0xfff4e5, 2.6);
  readonly ambient = new AmbientLight(0x8fa8ff, 0.3);
  /** Aufhellung in Bodennähe ({@link nearAmbientBoost}), fast neutral, damit Farben erhalten bleiben. */
  readonly boost = new AmbientLight(0xe4eaff, 0);
  /** Richtung zur Sonne im Welt-Frame. */
  readonly directionWorld = new Vector3(1, 0, 0);

  constructor(
    scene: Scene,
    private readonly globe: Object3D,
  ) {
    scene.add(this.sun, this.sun.target, this.ambient, this.boost);
  }

  /** Aktualisiert die Sonnenrichtung für den Zeitpunkt (ms seit Epoche). */
  update(timeMs: number): void {
    const d = sunDirectionEcef(new Date(timeMs));
    _dir.set(d.x, d.y, d.z).transformDirection(this.globe.matrixWorld);
    this.directionWorld.copy(_dir);
    this.globe.getWorldPosition(this.sun.target.position);
    this.sun.position.copy(this.sun.target.position).addScaledVector(_dir, 1e8);
  }
}
