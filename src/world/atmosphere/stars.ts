import {
  BufferGeometry,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  type Camera,
  type Object3D,
} from 'three';
import type { Rng } from '../../core/random';

/**
 * Sternenhimmel in eigener Szene mit eigener Kamera (nur Rotation), damit er unabhängig von
 * den Near/Far-Ebenen der Globus-Kamera immer im Hintergrund liegt.
 */
export class Starfield {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 10);
  private readonly points: Points<BufferGeometry, PointsMaterial>;

  constructor(rng: Rng, count = 5000) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rng.range(-1, 1);
      const phi = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - u * u);
      positions[i * 3] = r * Math.cos(phi) * 5;
      positions[i * 3 + 1] = u * 5;
      positions[i * 3 + 2] = r * Math.sin(phi) * 5;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /**
   * Übernimmt Blickrichtung und Bildwinkel der Hauptkamera. `globe` richtet den Himmel am
   * Erdkörper aus, damit er beim Verschieben des Ursprungs (Floating Origin) nicht springt.
   */
  sync(main: Camera & { fov?: number; aspect?: number }, globe?: Object3D): void {
    this.camera.quaternion.copy(main.quaternion);
    if (globe) globe.getWorldQuaternion(this.points.quaternion);
    if (main.fov !== undefined && main.aspect !== undefined) {
      if (this.camera.fov !== main.fov || this.camera.aspect !== main.aspect) {
        this.camera.fov = main.fov;
        this.camera.aspect = main.aspect;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  /** Sterne verblassen in der Atmosphäre (0 = am Boden, 1 = im All). */
  setVisibility(v: number): void {
    this.points.material.opacity = v;
    this.points.material.transparent = v < 1;
    this.points.visible = v > 0.01;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
