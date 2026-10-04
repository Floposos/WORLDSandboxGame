import { AmbientLight, DirectionalLight, Vector3, type Object3D, type Scene } from 'three';
import { sunDirectionEcef } from './sun';

const _dir = new Vector3();

/**
 * Sonnenlicht nach echtem Datum und Uhrzeit (NOAA, lokal berechnet) plus schwaches Umgebungslicht.
 * Das Umgebungslicht hält die Nachtseite erkennbar (Befund M1-Test: abends wirkte alles schwarz).
 */
export class SunLighting {
  readonly sun = new DirectionalLight(0xfff4e5, 2.6);
  readonly ambient = new AmbientLight(0x8fa8ff, 0.3);
  /** Richtung zur Sonne im Welt-Frame. */
  readonly directionWorld = new Vector3(1, 0, 0);

  constructor(
    scene: Scene,
    private readonly globe: Object3D,
  ) {
    scene.add(this.sun, this.sun.target, this.ambient);
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
