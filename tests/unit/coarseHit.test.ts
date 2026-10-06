import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { refineCoarseHit } from '../../src/tools/coarseHit';

// Flache Welt zum Testen: y = Höhe, x/z = Meter (als „Grad“ durchgereicht)
const toGeo = (p: Vector3) => ({ lat: p.z, lon: p.x, height: p.y });

describe('Treffer auf groben Kacheln', () => {
  // Kamera 1 850 m hoch, Blick 30° nach unten: das Gelände (0 m) liegt 3 700 m voraus
  const dir = new Vector3(0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6));
  const ray = new Ray(new Vector3(0, 1_850, 0), dir);

  it('schneidet das Höhenmodell, wenn die Kachel weit darunter liegt', () => {
    const coarse = { point: ray.at(10_000, new Vector3()), distance: 10_000 };
    const hit = refineCoarseHit(ray, coarse, toGeo, () => 0);
    expect(hit!.distance).toBeCloseTo(3_700, 0);
    expect(Math.abs(hit!.point.y)).toBeLessThan(0.1);
  });

  it('lässt genaue Treffer, Dächer und fehlende Höhendaten unverändert', () => {
    const exact = { point: ray.at(3_690, new Vector3()), distance: 3_690 };
    expect(refineCoarseHit(ray, exact, toGeo, () => 0)).toBe(exact);
    const coarse = { point: ray.at(10_000, new Vector3()), distance: 10_000 };
    expect(refineCoarseHit(ray, coarse, toGeo, () => null)).toBe(coarse);
    expect(refineCoarseHit(ray, null, toGeo, () => 0)).toBeNull();
  });
});
