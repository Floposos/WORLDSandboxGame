import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createBasis } from '../../src/core/floatingOrigin';
import { forwardFrom, headingPitchOf, quaternionFrom } from '../../src/camera/orientation';
import { flySpeed, FLY_BOOST } from '../../src/camera/flyCamera';
import { JUMP_SPEED, STEP_HEIGHT_M, walkStep, type WalkState } from '../../src/camera/groundCamera';
import { clipPlanes } from '../../src/camera/types';
import { ringOffsets, ringWidth, RING_SEGMENTS } from '../../src/world/targetPreview';

const basis = createBasis();

describe('Orientierung', () => {
  it('Kurs 0 blickt nach Norden (−z), 90 nach Osten (+x), Neigung −90 nach unten', () => {
    expect(forwardFrom(basis, 0, 0).z).toBeCloseTo(-1, 9);
    expect(forwardFrom(basis, 90, 0).x).toBeCloseTo(1, 9);
    expect(forwardFrom(basis, 0, -90).y).toBeCloseTo(-1, 9);
  });

  it('Quaternion lässt die Kamera entlang der Blickrichtung schauen, ohne Rollen', () => {
    for (const [h, p] of [
      [0, 0],
      [45, -20],
      [200, 30],
      [90, -89],
    ] as const) {
      const q = quaternionFrom(basis, h, p);
      const look = new Vector3(0, 0, -1).applyQuaternion(q);
      expect(look.distanceTo(forwardFrom(basis, h, p))).toBeLessThan(1e-9);
      const right = new Vector3(1, 0, 0).applyQuaternion(q);
      expect(Math.abs(right.dot(basis.up))).toBeLessThan(1e-9);
    }
  });

  it('headingPitchOf ist die Umkehrung von forwardFrom', () => {
    const hp = headingPitchOf(basis, forwardFrom(basis, 123, -35));
    expect(hp.heading).toBeCloseTo(123, 9);
    expect(hp.pitch).toBeCloseTo(-35, 9);
  });
});

describe('Flugkamera', () => {
  it('Tempo wächst mit der Höhe, Shift verfünffacht', () => {
    expect(flySpeed(2, false)).toBe(10);
    expect(flySpeed(1_000, false)).toBe(800);
    expect(flySpeed(1_000, true)).toBe(800 * FLY_BOOST);
  });

  it('Near bleibt am Boden klein, Far reicht über den Horizont', () => {
    const ground = clipPlanes(1.8, 40);
    expect(ground.near).toBe(0.1);
    expect(ground.far).toBeGreaterThan(300_000);
    expect(clipPlanes(10_000, 10_000).near).toBe(100);
  });
});

describe('Bodenkamera', () => {
  const standing: WalkState = { feet: 10, vUp: 0, onGround: true };
  const dt = 1 / 60;

  it('folgt dem Boden hangauf und hangab, ohne einzusinken', () => {
    expect(walkStep(standing, 10, 10.3, false, dt).state.feet).toBeCloseTo(10.3);
    expect(walkStep(standing, 10, 9.7, false, dt).state.feet).toBeCloseTo(9.7);
  });

  it('blockiert an Hindernissen höher als eine Stufe', () => {
    const r = walkStep(standing, 10, 10 + STEP_HEIGHT_M + 0.1, false, dt);
    expect(r.blocked).toBe(true);
    expect(r.state.feet).toBe(10);
  });

  it('springt und landet wieder auf dem Boden', () => {
    let s = walkStep(standing, 10, null, true, dt).state;
    expect(s.onGround).toBe(false);
    expect(s.vUp).toBeLessThan(JUMP_SPEED);
    let maxFeet = s.feet;
    for (let i = 0; i < 120 && !s.onGround; i++) {
      s = walkStep(s, 10, null, false, dt).state;
      maxFeet = Math.max(maxFeet, s.feet);
    }
    expect(s.onGround).toBe(true);
    expect(s.feet).toBe(10);
    // h = v²/2g ≈ 1,03 m
    expect(maxFeet - 10).toBeGreaterThan(0.9);
    expect(maxFeet - 10).toBeLessThan(1.15);
  });

  it('fällt von hohen Kanten statt hinunterzuschnappen', () => {
    const r = walkStep(standing, 10, 5, false, dt);
    expect(r.state.onGround).toBe(false);
    expect(r.state.feet).toBeLessThan(10);
    expect(r.state.feet).toBeGreaterThan(9.9);
  });
});

describe('Zielkreis', () => {
  it('Ring mit Innen- und Außenradius, geschlossen', () => {
    const o = ringOffsets(600);
    expect(o.length).toBe((RING_SEGMENTS + 1) * 4);
    expect(Math.hypot(o[2]!, o[3]!)).toBeCloseTo(600, 9);
    expect(Math.hypot(o[0]!, o[1]!)).toBeCloseTo(600 - ringWidth(600), 9);
    const last = o.length - 4;
    expect(o[last + 2]).toBeCloseTo(o[2]!, 9);
    expect(o[last + 3]).toBeCloseTo(o[3]!, 6);
  });
});
