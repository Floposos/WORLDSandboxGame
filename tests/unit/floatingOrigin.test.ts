import { describe, expect, it } from 'vitest';
import { Group, Object3D, Vector3 } from 'three';
import { createGameEvents } from '../../src/core/events';
import {
  FloatingOrigin,
  needsShift,
  shiftMatrix,
  shiftThreshold,
} from '../../src/core/floatingOrigin';
import { geodeticToEcef, LocalFrame } from '../../src/core/geo';
import type { GeoPoint } from '../../src/core/types';

const tokyo: GeoPoint = { lat: 35.6595, lon: 139.7005, height: 0 };

describe('Floating Origin – Schwelle', () => {
  it('verschiebt am Boden ab 5 km, in der Höhe ab 2 × Höhe', () => {
    expect(shiftThreshold(1.8)).toBe(5_000);
    expect(needsShift(4_999, 1.8)).toBe(false);
    expect(needsShift(5_001, 1.8)).toBe(true);
    expect(shiftThreshold(100_000)).toBe(200_000);
    expect(needsShift(150_000, 100_000)).toBe(false);
  });
});

describe('Floating Origin – Matrix D', () => {
  it('bildet alte lokale Koordinaten über ECEF auf neue ab (< 1 mm)', () => {
    const a = new LocalFrame(tokyo);
    const b = new LocalFrame({ lat: 35.7, lon: 139.75, height: 0 });
    const d = shiftMatrix(a, b);
    for (const p of [
      { lat: 35.66, lon: 139.71, height: 40 },
      { lat: 35.69, lon: 139.74, height: 600 },
    ]) {
      const ecef = geodeticToEcef(p);
      const inA = a.ecefToLocal(ecef);
      const inB = b.ecefToLocal(ecef);
      const mapped = new Vector3(inA.x, inA.y, inA.z).applyMatrix4(d);
      expect(mapped.distanceTo(new Vector3(inB.x, inB.y, inB.z))).toBeLessThan(1e-3);
    }
  });
});

describe('FloatingOrigin', () => {
  it('Welt ↔ geodätisch ist am Ursprung exakt und y zeigt nach oben', () => {
    const fo = new FloatingOrigin(new Group(), tokyo);
    const p = fo.geoToWorld({ ...tokyo, height: 10 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(0, 6);
    const back = fo.worldToGeo(new Vector3(100, 5, -200));
    const again = fo.geoToWorld(back);
    expect(again.distanceTo(new Vector3(100, 5, -200))).toBeLessThan(1e-3);
    const basis = fo.basisAt(new Vector3(0, 0, 0));
    expect(basis.up.y).toBeCloseTo(1, 9);
    expect(basis.north.z).toBeCloseTo(-1, 9);
    expect(basis.east.x).toBeCloseTo(1, 9);
  });

  it('nimmt Kamera und lokale Objekte mit, sodass ihr geografischer Ort gleich bleibt', () => {
    const globe = new Group();
    const events = createGameEvents();
    const shifts: number[][] = [];
    events.on('originShifted', (e) => shifts.push(e.matrix));
    const fo = new FloatingOrigin(globe, tokyo, events);
    const box = new Object3D();
    fo.local.add(box);
    box.position.copy(fo.geoToWorld({ lat: 35.7, lon: 139.75, height: 30 }));
    const camera = new Object3D();
    camera.position.copy(fo.geoToWorld({ lat: 35.701, lon: 139.751, height: 50 }));
    const boxGeoBefore = fo.worldToGeo(box.position);
    const camGeoBefore = fo.worldToGeo(camera.position);

    const d = fo.maybeShift(camera.position, 20, [camera]);
    expect(d).not.toBeNull();
    expect(shifts).toHaveLength(1);
    // Kamera steht jetzt (fast) über dem Ursprung
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThan(1e-3);
    expect(camera.position.y).toBeCloseTo(50, 3);
    const boxGeo = fo.worldToGeo(box.position);
    const camGeo = fo.worldToGeo(camera.position);
    expect(boxGeo.lat).toBeCloseTo(boxGeoBefore.lat, 9);
    expect(boxGeo.lon).toBeCloseTo(boxGeoBefore.lon, 9);
    expect(boxGeo.height).toBeCloseTo(boxGeoBefore.height, 3);
    expect(camGeo.height).toBeCloseTo(camGeoBefore.height, 3);
    // Globus-Matrix: der ECEF-Punkt des neuen Ursprungs liegt bei (0,0,0)
    const o = geodeticToEcef({ ...fo.origin, height: 0 });
    const inWorld = new Vector3(o.x, o.y, o.z).applyMatrix4(globe.matrixWorld);
    expect(inWorld.length()).toBeLessThan(1e-3);
    // Keine weitere Verschiebung direkt danach
    expect(fo.maybeShift(camera.position, 20, [camera])).toBeNull();
  });
});
