import { describe, expect, it } from 'vitest';
import { Vector3, Vector4 } from 'three';
import { enuBasis } from '../../src/core/geo';
import {
  airburstHeightM,
  MEGA_MAX_KT,
  MEGA_MIN_KT,
  mushroomSize,
  yieldRadii,
} from '../../src/physics/nuclear';
import { COMPLEX_CRATER_M, finalCraterM, gloomFromEnergy } from '../../src/physics/impact';
import { formatEnergy, formatLength, formatTnt } from '../../src/tools/explosions';
import { createDefaultRegistry } from '../../src/tools/index';
import { asteroidImpact } from '../../src/tools/tier5/asteroid';
import { roundYield } from '../../src/tools/tier5/megaBomb';
import {
  MOON_END_S,
  MOON_IMPACT_S,
  moonDay,
  moonDistance,
  moonPhase,
  moonPosition,
  moonProgress,
  ROCHE_M,
  ROCHE_PROGRESS,
} from '../../src/tools/tier5/moonDrop';
import { roundSignificant } from '../../src/ui/ToolParams';
import { eventSlot } from '../../src/world/globeFx/globeEffects';
import {
  arcAngle,
  EARTH_RADIUS_M,
  emptySlot,
  OVERLAY_EVENTS,
  overlayFade,
  packSlots,
} from '../../src/world/globeFx/overlay';

const geo = { lat: 53.5, lon: 10, height: 0 };

describe('Stufe 5: Registrierung (Spec 8)', () => {
  const registry = createDefaultRegistry();

  it('enthält Mega-Bombe, Asteroid und Mond-Absturz mit den Grenzen der Spezifikation', () => {
    expect(registry.byTier(5).map((t) => t.id)).toEqual(['mega-bomb', 'asteroid', 'moon-drop']);
    const param = (id: string, key: string) => registry.get(id)!.params.find((p) => p.key === key)!;
    expect([param('mega-bomb', 'yield').min, param('mega-bomb', 'yield').max]).toEqual([1, 50_000]);
    expect(param('mega-bomb', 'yield').scale).toBe('log');
    expect([param('asteroid', 'diameter').min, param('asteroid', 'diameter').max]).toEqual([1, 50]);
    expect(registry.get('asteroid')!.targetMode).toBe('globe');
    expect(registry.get('mega-bomb')!.targetMode).toBe('both');
    expect(param('moon-drop', 'start').type).toBe('action');
  });
});

describe('Mega-Bombe: Wirkungsradien', () => {
  it('liegt für 1 Mt in der bekannten Größenordnung', () => {
    const r = yieldRadii(1_000);
    expect(r.fireballM).toBeCloseTo(1_046, -1);
    expect(r.heavyM).toBeGreaterThan(1_800);
    expect(r.heavyM).toBeLessThan(3_500);
    expect(r.lightM).toBeGreaterThan(9_000);
    expect(r.lightM).toBeLessThan(16_000);
  });

  it('wächst monoton und ordnet Feuerball < schwer < leicht', () => {
    let prev = yieldRadii(MEGA_MIN_KT);
    for (const kt of [10, 100, 1_000, 10_000, MEGA_MAX_KT]) {
      const r = yieldRadii(kt);
      expect(r.fireballM).toBeLessThan(r.heavyM);
      expect(r.heavyM).toBeLessThan(r.lightM);
      expect(r.lightM).toBeGreaterThan(prev.lightM);
      prev = r;
    }
    // Überdruckradien skalieren kubisch mit der Ladung (Hopkinson)
    expect(yieldRadii(8_000).lightM / yieldRadii(1_000).lightM).toBeCloseTo(2, 1);
  });

  it('Pilzwolke: 50 Mt reichen bis in die Stratosphäre, Hut breiter als Stiel', () => {
    const big = mushroomSize(MEGA_MAX_KT);
    expect(big.heightM).toBeGreaterThan(45_000);
    expect(big.heightM).toBeLessThan(70_000);
    expect(big.capRadiusM).toBeGreaterThan(big.stemRadiusM * 3);
    expect(mushroomSize(20).heightM).toBeLessThan(big.heightM);
  });

  it('Luftdetonation liegt über dem Feuerball', () => {
    expect(airburstHeightM(100)).toBeGreaterThan(yieldRadii(100).fireballM);
  });

  it('rundet die Sprengkraft auf zwei geltende Ziffern innerhalb der Grenzen', () => {
    expect(roundYield(1234)).toBe(1200);
    expect(roundYield(0.2)).toBe(MEGA_MIN_KT);
    expect(roundYield(1e9)).toBe(MEGA_MAX_KT);
    expect(roundSignificant(47_123)).toBe(47_000);
    expect(roundSignificant(0)).toBe(0);
  });
});

describe('Asteroid', () => {
  it('Endkrater: einfach bis 3,2 km, darüber komplex (Collins et al.)', () => {
    expect(finalCraterM(1_000)).toBeCloseTo(1_250);
    const dtc = COMPLEX_CRATER_M / 1.25;
    expect(finalCraterM(dtc)).toBeCloseTo(COMPLEX_CRATER_M, 0);
    // Am Übergang stetig und monoton
    let prev = 0;
    for (let d = dtc * 0.9; d < dtc * 1.5; d += 10) {
      expect(finalCraterM(d)).toBeGreaterThanOrEqual(prev);
      prev = finalCraterM(d);
    }
    expect(finalCraterM(dtc * 1.5)).toBeGreaterThan(COMPLEX_CRATER_M);
  });

  it('ein 10-km-Körper hat Chicxulub-Format und verdunkelt die ganze Erde', () => {
    const a = asteroidImpact(10_000, 20, 45);
    expect(a.energyJ).toBeGreaterThan(1e23);
    expect(a.energyJ).toBeLessThan(1e24);
    expect(a.craterM).toBeGreaterThan(80_000);
    expect(a.craterM).toBeLessThan(250_000);
    expect(a.gloom).toBeGreaterThan(0.99);
    expect(a.dustM).toBeCloseTo(Math.PI * EARTH_RADIUS_M, -3);
  });

  it('ein 1-km-Körper verdunkelt nur teilweise; die Druckwelle bleibt auf der Erde', () => {
    const a = asteroidImpact(1_000, 20, 45);
    expect(a.gloom).toBeGreaterThan(0.1);
    expect(a.gloom).toBeLessThan(0.6);
    const huge = asteroidImpact(50_000, 72, 90);
    expect(huge.shockM).toBeLessThanOrEqual(Math.PI * EARTH_RADIUS_M);
  });

  it('Verdunkelung nach Energie ist begrenzt und monoton', () => {
    expect(gloomFromEnergy(0)).toBe(0);
    expect(gloomFromEnergy(1e18)).toBe(0);
    expect(gloomFromEnergy(1e21)).toBeGreaterThan(gloomFromEnergy(1e20));
    expect(gloomFromEnergy(1e30)).toBe(1);
  });
});

describe('Mond-Absturz: Ablauf', () => {
  it('beginnt außerhalb der Roche-Grenze und endet auf der Erdoberfläche', () => {
    expect(moonDistance(0)).toBeGreaterThan(ROCHE_M);
    expect(moonDistance(ROCHE_PROGRESS)).toBeCloseTo(ROCHE_M, -2);
    expect(moonDistance(1)).toBeCloseTo(EARTH_RADIUS_M, -2);
  });

  it('durchläuft die Phasen in der richtigen Reihenfolge und endet', () => {
    const seen: string[] = [];
    for (let t = 0; t <= MOON_END_S + 1; t += 0.1) {
      const p = moonPhase(t);
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual(['approach', 'breakup', 'impact', 'aftermath', 'done']);
    expect(moonProgress(MOON_IMPACT_S)).toBeCloseTo(1);
    expect(moonDay(0)).toBe(1);
    expect(moonDay(MOON_IMPACT_S)).toBe(5);
  });

  it('die Bahn endet genau über dem Einschlagort', () => {
    const b = enuBasis(geo);
    const basis = {
      east: new Vector3(b.east.x, b.east.y, b.east.z),
      north: new Vector3(b.north.x, b.north.y, b.north.z),
      up: new Vector3(b.up.x, b.up.y, b.up.z),
    };
    const end = moonPosition(1, basis);
    expect(end.length()).toBeCloseTo(EARTH_RADIUS_M, -2);
    expect(end.clone().normalize().dot(basis.up)).toBeCloseTo(1, 6);
    const start = moonPosition(0, basis);
    expect(start.clone().normalize().dot(basis.up)).toBeLessThan(0.5);
  });
});

describe('Effekt-Hülle', () => {
  it('Winkel aus Strecken, höchstens π', () => {
    expect(arcAngle(EARTH_RADIUS_M)).toBeCloseTo(1);
    expect(arcAngle(1e9)).toBeCloseTo(Math.PI);
    expect(arcAngle(-5)).toBe(0);
  });

  it('blendet erst oberhalb der Atmosphäre ein', () => {
    expect(overlayFade(0)).toBe(0);
    expect(overlayFade(30_000)).toBe(0);
    expect(overlayFade(90_000)).toBeCloseTo(0.5);
    expect(overlayFade(500_000)).toBe(1);
  });

  it('Druckwelle wandert, Blitz klingt ab, Krater bleibt', () => {
    const spec = {
      geo,
      flash: { seconds: 2 },
      shock: { maxM: 1_000_000, speedMs: 100_000 },
      crater: { radiusM: 50_000 },
    };
    const s = emptySlot();
    expect(eventSlot(spec, 0.5, s)).toBe(true);
    const shock1 = s.shock;
    expect(s.flash).toBeGreaterThan(0);
    eventSlot(spec, 5, s);
    expect(s.shock).toBeGreaterThan(shock1);
    expect(s.flash).toBe(0);
    expect(eventSlot(spec, 3_600, s)).toBe(true);
    expect(s.crater).toBeCloseTo(arcAngle(50_000));
  });

  it('Ereignisse ohne bleibende Teile fallen weg', () => {
    const s = emptySlot();
    expect(eventSlot({ geo, flash: { seconds: 1 } }, 2, s)).toBe(false);
  });

  it('packt höchstens die neuesten Ereignisse und schaltet den Rest ab', () => {
    const v = () => Array.from({ length: OVERLAY_EVENTS }, () => new Vector4());
    const [center, rings, shock, scar] = [v(), v(), v(), v()];
    const slots = Array.from({ length: OVERLAY_EVENTS + 2 }, (_, i) => {
      const s = emptySlot();
      s.flash = i;
      return s;
    });
    expect(packSlots(slots, center, rings, shock, scar)).toBe(OVERLAY_EVENTS);
    expect(scar[0]!.w).toBe(2);
    expect(center.every((c) => c.w === 1)).toBe(true);
    expect(packSlots(slots.slice(0, 1), center, rings, shock, scar)).toBe(1);
    expect(center[1]!.w).toBe(0);
  });
});

describe('Lesbare Einheiten', () => {
  it('reichen bis Tt TNT und YJ', () => {
    expect(formatTnt(5e10)).toMatch(/50 Mt/);
    expect(formatTnt(7.5e16)).toMatch(/75 Tt/);
    expect(formatEnergy(3.14e23)).toMatch(/314 ZJ/);
    expect(formatEnergy(4e25)).toMatch(/40 YJ/);
    expect(formatEnergy(2e18)).toMatch(/2 EJ/);
    expect(formatLength(950)).toBe('950 m');
    expect(formatLength(119_258)).toMatch(/119 km/);
  });
});
