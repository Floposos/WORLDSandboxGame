import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, PRESETS, saveSettings } from '../../src/core/settings';

describe('settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Presets sind nach Leistung geordnet', () => {
    const order = [PRESETS.low, PRESETS.medium, PRESETS.high, PRESETS.ultra];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.maxBodies).toBeGreaterThan(order[i - 1]!.maxBodies);
      expect(order[i]!.maxParticles).toBeGreaterThan(order[i - 1]!.maxParticles);
      expect(order[i]!.tileErrorTarget).toBeLessThan(order[i - 1]!.tileErrorTarget);
    }
  });

  it('fällt ohne localStorage auf Defaults zurück', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });

  it('wirft nicht, wenn localStorage selbst wirft', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    expect(loadSettings().preset).toBe('medium');
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });

  it('verwirft ein unbekanntes Preset', () => {
    const data = new Map<string, string>([
      ['globebox:settings', JSON.stringify({ preset: 'mega', reduceMotion: true })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    });
    const s = loadSettings();
    expect(s.preset).toBe('medium');
    expect(s.reduceMotion).toBe(true);
  });
});
