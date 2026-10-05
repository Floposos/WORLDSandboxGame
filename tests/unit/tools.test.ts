import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../src/tools';
import { stackOffsets, yawTowards } from '../../src/tools/shared';
import { clampParam, defaultParams, ToolRegistry, type Tool } from '../../src/tools/Tool';
import { pushFalloff, PUSH_HALF_ANGLE_DEG } from '../../src/tools/tier2/forcePush';
import { magnetAccel } from '../../src/tools/tier2/magnet';
import { ballRadius } from '../../src/tools/tier2/wreckingBall';
import { Vector3 } from 'three';

describe('Werkzeug-Registry (Spec 4.5)', () => {
  const registry = createDefaultRegistry();

  it('enthält alle Werkzeuge der Stufen 0 und 2 aus Spec 8', () => {
    expect(registry.byTier(0).map((t) => t.id)).toEqual([
      'place-box',
      'place-ball',
      'place-car',
      'place-npcs',
      'place-wall',
      'eraser',
    ]);
    expect(registry.byTier(2).map((t) => t.id)).toEqual([
      'throw',
      'wrecking-ball',
      'force-push',
      'magnet',
    ]);
  });

  it('jedes Werkzeug hat Name, Beschreibung, Icon und gültige Standardwerte', () => {
    for (const tool of registry.all()) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.icon.length).toBeGreaterThan(0);
      const d = defaultParams(tool);
      for (const p of tool.params) {
        if (p.type === 'action') expect(d[p.key]).toBeUndefined();
        else expect(clampParam(p, d[p.key])).toEqual(d[p.key]);
      }
    }
  });

  it('lehnt doppelte IDs ab', () => {
    const r = new ToolRegistry();
    const tool = { id: 'x', name: 'x', tier: 0, icon: 'box', description: '', params: [] } as Tool;
    r.register(tool);
    expect(() => r.register(tool)).toThrow();
  });

  it('clampParam klemmt Zahlen und verwirft unbekannte Optionen', () => {
    const n = { key: 'n', label: '', type: 'number' as const, min: 1, max: 200, default: 1 };
    expect(clampParam(n, 500)).toBe(200);
    expect(clampParam(n, 'abc')).toBe(1);
    const s = {
      key: 's',
      label: '',
      type: 'select' as const,
      options: [{ value: 'a', label: 'A' }],
      default: 'a',
    };
    expect(clampParam(s, 'b')).toBe('a');
  });
});

describe('Werkzeug-Formeln', () => {
  it('Stapel: n Plätze, keine Überlappung, Lagen von unten', () => {
    const o = stackOffsets(200, 1);
    expect(o).toHaveLength(200);
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 1; j < o.length; j++) expect(o[i]!.distanceTo(o[j]!)).toBeGreaterThan(0.99);
    }
    expect(Math.min(...o.map((v) => v.y))).toBeCloseTo(0.5);
  });

  it('Kraftstoß fällt mit Entfernung und Winkel ab, 0 außerhalb des Kegels', () => {
    expect(pushFalloff(0, 0, 50, 10)).toBe(10);
    expect(pushFalloff(25, 0, 50, 10)).toBe(5);
    expect(pushFalloff(60, 0, 50, 10)).toBe(0);
    expect(pushFalloff(10, PUSH_HALF_ANGLE_DEG + 1, 50, 10)).toBe(0);
    expect(pushFalloff(10, 10, 50, 10)).toBeLessThan(pushFalloff(10, 0, 50, 10));
  });

  it('Magnet zieht innerhalb des Radius, außerhalb nicht', () => {
    expect(magnetAccel(30, 25, 2)).toBe(0);
    expect(magnetAccel(5, 25, 2)).toBeGreaterThan(magnetAccel(20, 25, 2));
    expect(magnetAccel(0, 25, 2)).toBe(0);
  });

  it('Abrissbirne: 2 t Stahl ≈ 0,4 m Radius', () => {
    expect(ballRadius(2_000)).toBeCloseTo(0.39, 2);
  });

  it('yawTowards dreht −z zum Ziel', () => {
    const yaw = yawTowards(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const fwd = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), yaw);
    expect(fwd.x).toBeCloseTo(1);
  });
});
