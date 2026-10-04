import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';

const _m = new Matrix4();
const _c = new Color();
const _zero = new Vector3(0, 0, 0);
const _q = new Quaternion();

/**
 * Instanz-Pool (Spec 11: Instancing für gleiche Meshes): ein `InstancedMesh` mit fester
 * Kapazität und Freiliste. Freie Instanzen haben Skalierung 0.
 */
export class InstancedPool {
  readonly mesh: InstancedMesh<BufferGeometry, MeshLambertMaterial>;
  private readonly free: number[] = [];
  private high = 0;

  constructor(geometry: BufferGeometry, capacity: number, name: string) {
    this.mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ color: 0xffffff }), capacity);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // Instanzen verteilen sich über die ganze Blase
    // Farb-Attribut anlegen, damit setColorAt sofort wirkt
    this.mesh.setColorAt(0, _c.set(0xffffff));
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  get used(): number {
    return this.high - this.free.length;
  }

  /** Belegt eine Instanz; -1, wenn der Pool voll ist. */
  acquire(color: number): number {
    const idx = this.free.pop() ?? (this.high < this.capacity ? this.high++ : -1);
    if (idx < 0) return -1;
    this.mesh.count = Math.max(this.mesh.count, idx + 1);
    this.mesh.setColorAt(idx, _c.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return idx;
  }

  set(idx: number, pos: Vector3, quat: Quaternion, scale: Vector3): void {
    _m.compose(pos, quat, scale);
    this.mesh.setMatrixAt(idx, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  release(idx: number): void {
    if (idx < 0) return;
    _m.compose(_zero, _q, _zero);
    this.mesh.setMatrixAt(idx, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(idx);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
