import type { DynamicRayCastVehicleController } from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { PhysicsWorld, SimBody } from './world';

/** Maße des einfachen Autos in m (Kompaktklasse). */
export const CAR = {
  halfWidth: 0.9,
  halfHeight: 0.35,
  halfLength: 2.2,
  wheelRadius: 0.35,
  mass: 1_200,
  /** Motorkraft pro angetriebenem Rad (N) und Bremskraft. */
  engineForce: 2_400,
  brakeForce: 40,
  maxSteer: 0.5,
} as const;

/** Fahreingabe: Gas (−1 rückwärts … 1 vorwärts), Lenkung (−1 rechts … 1 links), Bremse. */
export interface DriveInput {
  throttle: number;
  steer: number;
  brake: boolean;
}

/**
 * Lenkwinkel weich nachführen (rein, testbar): höchstens `rate` rad/s, Ziel = steer · maxSteer.
 * Bei höherem Tempo wird der Ausschlag kleiner, damit das Auto nicht umkippt.
 */
export function steerToward(current: number, steer: number, speedMs: number, dt: number): number {
  const limit = CAR.maxSteer / (1 + Math.abs(speedMs) / 15);
  const target = Math.max(-1, Math.min(1, steer)) * limit;
  const rate = 2.5 * dt;
  return current + Math.max(-rate, Math.min(rate, target - current));
}

/** Radpositionen relativ zur Karosserie (vorn = −z, wie three.js-Kameras). */
const WHEELS: readonly [number, number, boolean][] = [
  [-CAR.halfWidth + 0.1, -CAR.halfLength + 0.65, true],
  [CAR.halfWidth - 0.1, -CAR.halfLength + 0.65, true],
  [-CAR.halfWidth + 0.1, CAR.halfLength - 0.65, false],
  [CAR.halfWidth - 0.1, CAR.halfLength - 0.65, false],
];

const CAR_COLORS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e];

const _q = new Quaternion();
const _axisX = new Vector3(1, 0, 0);
const _axisY = new Vector3(0, 1, 0);

/**
 * Einfaches Auto (Spec 8 `place-car`): Chassis + 4 Räder mit dem Raycast-Fahrzeug von Rapier.
 * Steuerung über {@link DriveInput} (Fahrmodus im Engine-Code: W/S, A/D, Leertaste bremst).
 */
export class Car {
  readonly body: SimBody;
  readonly controller: DynamicRayCastVehicleController;
  readonly root = new Group();
  private readonly wheelMeshes: Mesh[] = [];
  input: DriveInput = { throttle: 0, steer: 0, brake: false };
  private steering = 0;

  constructor(
    private readonly world: PhysicsWorld,
    pos: Vector3,
    yaw: number,
    colorIndex: number,
  ) {
    const R = world.R;
    const rot = new Quaternion().setFromAxisAngle(_axisY, yaw);
    const volume = 8 * CAR.halfWidth * CAR.halfHeight * CAR.halfLength;
    const { rb, collider } = world.createDynamic(
      pos.x,
      pos.y + CAR.wheelRadius + CAR.halfHeight + 0.3,
      pos.z,
      R.ColliderDesc.cuboid(CAR.halfWidth, CAR.halfHeight, CAR.halfLength)
        .setDensity(CAR.mass / volume)
        .setFriction(0.5),
      (d) => d.setRotation(rot).setCanSleep(false).setAngularDamping(0.5),
    );
    this.controller = world.world.createVehicleController(rb);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    for (const [x, z] of WHEELS) {
      this.controller.addWheel(
        { x, y: -CAR.halfHeight + 0.05, z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        0.3,
        CAR.wheelRadius,
      );
    }
    for (let i = 0; i < WHEELS.length; i++) {
      this.controller.setWheelSuspensionStiffness(i, 28);
      this.controller.setWheelSuspensionCompression(i, 4);
      this.controller.setWheelSuspensionRelaxation(i, 4.5);
      this.controller.setWheelFrictionSlip(i, 2.2);
      this.controller.setWheelMaxSuspensionTravel(i, 0.25);
    }

    // Darstellung: Karosserie, Kabine, Räder
    const color = CAR_COLORS[colorIndex % CAR_COLORS.length]!;
    const paint = new MeshLambertMaterial({ color });
    const glass = new MeshLambertMaterial({ color: 0x1d2a35 });
    const tyre = new MeshLambertMaterial({ color: 0x1a1a1a });
    const chassis = new Mesh(
      new BoxGeometry(CAR.halfWidth * 2, CAR.halfHeight * 2, CAR.halfLength * 2),
      paint,
    );
    const cabin = new Mesh(new BoxGeometry(CAR.halfWidth * 1.8, 0.5, CAR.halfLength * 1.05), glass);
    cabin.position.set(0, CAR.halfHeight + 0.25, 0.15);
    this.root.add(chassis, cabin);
    const wheelGeo = new CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.25, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < WHEELS.length; i++) {
      const w = new Mesh(wheelGeo, tyre);
      this.wheelMeshes.push(w);
      this.root.add(w);
    }
    this.root.name = 'car';

    this.body = world.register('car', rb, [collider], { object: this.root }, volume);
    this.body.pinned = true;
    this.body.onStep = (dt) => this.step(dt);
    this.body.onRemove = () => {
      this.world.world.removeVehicleController(this.controller);
    };
    this.body.onFree = () => {
      for (const g of new Set([chassis.geometry, cabin.geometry, wheelGeo])) g.dispose();
      for (const m of [paint, glass, tyre]) m.dispose();
    };
  }

  /** Tempo in m/s, vorwärts positiv (Rapier misst entlang +z, vorn ist −z). */
  get speed(): number {
    return -this.controller.currentVehicleSpeed();
  }

  private step(dt: number): void {
    const c = this.controller;
    const { throttle, brake } = this.input;
    this.steering = steerToward(this.steering, this.input.steer, this.speed, dt);
    for (let i = 0; i < WHEELS.length; i++) {
      const front = WHEELS[i]![2];
      c.setWheelSteering(i, front ? this.steering : 0);
      // Hinterradantrieb; vorn = −z, also negative Kraft für vorwärts
      c.setWheelEngineForce(i, front ? 0 : -throttle * CAR.engineForce);
      c.setWheelBrake(i, brake ? CAR.brakeForce : throttle === 0 ? 2 : 0);
    }
    c.updateVehicle(dt);
  }

  /** Räder an Federweg, Lenkung und Drehung anpassen (pro Frame). */
  updateWheels(): void {
    const c = this.controller;
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const [x, z] = WHEELS[i]!;
      const travel = c.wheelSuspensionLength(i) ?? 0.3;
      const mesh = this.wheelMeshes[i]!;
      mesh.position.set(x, -CAR.halfHeight + 0.05 - travel, z);
      mesh.quaternion
        .setFromAxisAngle(_axisY, c.wheelSteering(i) ?? 0)
        .multiply(_q.setFromAxisAngle(_axisX, c.wheelRotation(i) ?? 0));
    }
  }
}
