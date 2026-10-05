import { describe, expect, it, vi } from 'vitest';
import { Color, Scene } from 'three';
import {
  openMeteoUrl,
  presetWind,
  STORM_WIND_MS,
  WeatherClient,
  weatherFromOpenMeteo,
  weatherFromPreset,
  WEATHER_CACHE_MS,
  windVector,
  type OpenMeteoCurrent,
} from '../../src/world/weather/weather';
import {
  fogDensity,
  sunFactor,
  visibilityM,
  WeatherSystem,
} from '../../src/world/weather/weatherSystem';
import { compass, weatherSummary } from '../../src/tools/tier1/weather';
import { localFromTime, solarOffsetMs, timeFromLocal } from '../../src/tools/tier1/timeOfDay';

/** Antwort von Open-Meteo bauen (nur die Felder, die wir lesen). */
function answer(current: Partial<NonNullable<OpenMeteoCurrent['current']>>): OpenMeteoCurrent {
  return {
    current: {
      time: '2026-10-05T12:00',
      interval: 900,
      temperature_2m: 12,
      precipitation: 0,
      rain: 0,
      snowfall: 0,
      cloud_cover: 0,
      wind_speed_10m: 4,
      wind_direction_10m: 270,
      is_day: 1,
      weather_code: 0,
      ...current,
    },
  };
}

describe('Echtwetter von Open-Meteo (Spec 5.5)', () => {
  it('fragt die Felder der Spezifikation ab, Wind in m/s', () => {
    const url = openMeteoUrl(51.5072, -0.1276);
    expect(url).toContain(
      'https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276',
    );
    for (const field of [
      'temperature_2m',
      'precipitation',
      'rain',
      'snowfall',
      'cloud_cover',
      'wind_speed_10m',
      'wind_direction_10m',
      'is_day',
    ]) {
      expect(url).toContain(field);
    }
    expect(url).toContain('wind_speed_unit=ms');
  });

  it('übersetzt klar, bewölkt, Regen, Schnee, Gewitter und Nebel', () => {
    expect(weatherFromOpenMeteo(answer({ cloud_cover: 3 })).preset).toBe('clear');
    expect(weatherFromOpenMeteo(answer({ cloud_cover: 85 })).preset).toBe('cloudy');
    const rain = weatherFromOpenMeteo(
      answer({ cloud_cover: 100, precipitation: 1.4, rain: 1.4, weather_code: 63 }),
    );
    expect(rain).toMatchObject({ preset: 'rain', precipitation: 'rain', cloudCover: 1 });
    // 1,4 mm in 15 min = 5,6 mm/h von 8 mm/h
    expect(rain.intensity).toBeCloseTo(0.7, 2);
    const snow = weatherFromOpenMeteo(
      answer({ snowfall: 0.5, precipitation: 0.4, cloud_cover: 95, weather_code: 73 }),
    );
    expect(snow).toMatchObject({ preset: 'snow', precipitation: 'snow' });
    expect(weatherFromOpenMeteo(answer({ weather_code: 95, cloud_cover: 100 })).preset).toBe(
      'storm',
    );
    expect(weatherFromOpenMeteo(answer({ weather_code: 45, cloud_cover: 40 })).preset).toBe('fog');
  });

  it('nimmt Temperatur, Wind und Bewölkung unverändert und klemmt die Richtung', () => {
    const w = weatherFromOpenMeteo(
      answer({
        temperature_2m: -3.5,
        wind_speed_10m: 7.5,
        wind_direction_10m: 400,
        cloud_cover: 60,
      }),
    );
    expect(w.temperatureC).toBe(-3.5);
    expect(w.windSpeedMs).toBe(7.5);
    expect(w.windDirectionDeg).toBe(40);
    expect(w.cloudCover).toBeCloseTo(0.6, 6);
  });

  it('meldet eine Antwort ohne "current" als Fehler', () => {
    expect(() => weatherFromOpenMeteo({})).toThrow();
  });

  it('cacht 15 Minuten je Rasterpunkt und fragt danach erneut', async () => {
    let calls = 0;
    let now = 1_000_000;
    const fetchImpl = vi.fn(() => {
      calls++;
      return Promise.resolve(
        new Response(JSON.stringify(answer({ temperature_2m: calls })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const client = new WeatherClient({ fetchImpl, now: () => now });
    const a = await client.current(51.5072, -0.1276);
    const b = await client.current(51.5099, -0.1299); // gleicher Rasterpunkt
    expect(b).toBe(a);
    expect(calls).toBe(1);
    await client.current(48.1, 11.6);
    expect(calls).toBe(2);
    now += WEATHER_CACHE_MS + 1;
    await client.current(51.5072, -0.1276);
    expect(calls).toBe(3);
  });
});

describe('Wetterzustand und Wind', () => {
  it('Voreinstellungen setzen Wolken und Niederschlag', () => {
    expect(weatherFromPreset('clear', 3, 250)).toMatchObject({
      precipitation: 'none',
      intensity: 0,
    });
    expect(weatherFromPreset('storm', 20, 0).intensity).toBe(1);
    expect(weatherFromPreset('snow', 5, 90).precipitation).toBe('snow');
    // Unbekannte Voreinstellung fällt auf „klar“ zurück
    expect(weatherFromPreset('quatsch' as 'clear', 1, 0).preset).toBe('clear');
  });

  it('Gewitter hebt den Wind an, andere Wechsel lassen ihn stehen', () => {
    expect(presetWind('rain', 'storm', 3)).toBe(STORM_WIND_MS);
    expect(presetWind('clear', 'storm', 30)).toBe(30);
    // Wer im Gewitter den Wind zurückdreht, behält seinen Wert
    expect(presetWind('storm', 'storm', 5)).toBe(5);
    expect(presetWind('storm', 'rain', 18)).toBe(18);
  });

  it('Windvektor: meteorologische Richtung ist die Herkunft (ENU, z = −Nord)', () => {
    const north = windVector({ windSpeedMs: 10, windDirectionDeg: 0 });
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.z).toBeCloseTo(10, 6); // nach Süden = +z
    const west = windVector({ windSpeedMs: 10, windDirectionDeg: 270 });
    expect(west.x).toBeCloseTo(10, 6); // nach Osten
    expect(west.z).toBeCloseTo(0, 6);
  });

  it('Sichtweite, Nebeldichte und Sonnenlicht hängen am Wetter', () => {
    expect(visibilityM(weatherFromPreset('fog', 0, 0))).toBeLessThan(500);
    expect(visibilityM(weatherFromPreset('clear', 0, 0))).toBeGreaterThan(50_000);
    expect(fogDensity(220)).toBeGreaterThan(fogDensity(9_000));
    expect(sunFactor(weatherFromPreset('clear', 0, 0))).toBeGreaterThan(0.9);
    expect(sunFactor(weatherFromPreset('storm', 0, 0))).toBeLessThan(0.4);
  });

  it('Himmel wird mit der Bewölkung grau, Blitze hellen auf', () => {
    const system = new WeatherSystem(new Scene(), 16);
    const clear = new Color(0.1, 0.4, 0.9);
    system.set(weatherFromPreset('clear', 0, 0));
    system.tintSky(clear, 1);
    const cloudy = new Color(0.1, 0.4, 0.9);
    system.set(weatherFromPreset('storm', 0, 0));
    system.tintSky(cloudy, 1);
    expect(Math.abs(cloudy.r - cloudy.b)).toBeLessThan(Math.abs(clear.r - clear.b));
    system.dispose();
  });

  it('„Bewegung reduzieren“ unterdrückt das Aufhellen durch Blitze', () => {
    const system = new WeatherSystem(new Scene(), 16);
    system.set(weatherFromPreset('storm', 0, 0));
    system.flash = 1;
    const bright = system.tintSky(new Color(0.1, 0.1, 0.2), 1);
    system.reduceFlashes = true;
    expect(system.lightFlash).toBe(0);
    const calm = system.tintSky(new Color(0.1, 0.1, 0.2), 1);
    expect(calm.r).toBeLessThan(bright.r);
    system.dispose();
  });
});

describe('Werkzeug Wetter (Spec 8)', () => {
  it('Himmelsrichtung und Zusammenfassung', () => {
    const names = [
      'N',
      'NNO',
      'NO',
      'ONO',
      'O',
      'OSO',
      'SO',
      'SSO',
      'S',
      'SSW',
      'SW',
      'WSW',
      'W',
      'WNW',
      'NW',
      'NNW',
    ];
    expect(compass(0, names)).toBe('N');
    expect(compass(225, names)).toBe('SW');
    expect(compass(359, names)).toBe('N');
    const text = weatherSummary(
      weatherFromOpenMeteo(
        answer({
          cloud_cover: 100,
          rain: 1.4,
          precipitation: 1.4,
          weather_code: 63,
          temperature_2m: 11.2,
          wind_speed_10m: 7.5,
          wind_direction_10m: 225,
        }),
      ),
    );
    expect(text).toContain('Regen');
    expect(text).toContain('11,2');
    expect(text).toContain('100');
    expect(text).toContain('SW');
  });
});

describe('Werkzeug Tageszeit (Spec 8)', () => {
  it('rechnet Ortszeit über den Längengrad', () => {
    expect(solarOffsetMs(15)).toBe(3_600_000);
    const ms = timeFromLocal(2026, 6, 21, 12, 15);
    // 12 Uhr Ortszeit bei 15° Ost = 11 Uhr UTC
    expect(new Date(ms).toISOString()).toBe('2026-06-21T11:00:00.000Z');
    expect(localFromTime(ms, 15)).toMatchObject({ year: 2026, month: 6, day: 21, hour: 12 });
  });

  it('klemmt den Tag auf die Monatslänge', () => {
    const ms = timeFromLocal(2026, 2, 31, 12, 0);
    expect(new Date(ms).getUTCDate()).toBe(28);
  });
});
