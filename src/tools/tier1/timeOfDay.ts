import { store } from '../../core/store';
import { t } from '../../ui/i18n';
import { num, type Tool } from '../Tool';

const HOUR_MS = 3_600_000;

/** Mittlere Sonnenzeit am Längengrad: UTC + lon/15 h (SIMPLIFIED: ohne Zeitgleichung). */
export function solarOffsetMs(lon: number): number {
  return (lon / 15) * HOUR_MS;
}

/** Zeitpunkt (ms, UTC) aus Ortszeit (Stunde), Tag, Monat und Jahr am Längengrad `lon`. */
export function timeFromLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  lon: number,
): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Math.round(day)), days);
  return Date.UTC(year, month - 1, d) + hour * HOUR_MS - solarOffsetMs(lon);
}

/** Ortszeit am Längengrad aus einem Zeitpunkt: Jahr, Monat (1–12), Tag, Stunde (Viertelstunden). */
export function localFromTime(
  timeMs: number,
  lon: number,
): { year: number; month: number; day: number; hour: number } {
  const d = new Date(timeMs + solarOffsetMs(lon));
  const hour = Math.round((d.getUTCHours() + d.getUTCMinutes() / 60) * 4) / 4;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: Math.min(23.75, hour),
  };
}

/**
 * `time-of-day` (Spec 8): Uhrzeit und Datum für den Sonnenstand. Wirkt sofort; die Uhrzeit ist
 * die Sonnenzeit am Ort der Blase bzw. unter der Kamera (12 Uhr ≈ Sonne im Süden).
 */
export function createTimeOfDayTool(): Tool {
  const tt = t.tools['time-of-day'];
  return {
    id: 'time-of-day',
    name: tt.name,
    tier: 1,
    icon: 'clock',
    description: tt.description,
    params: [
      {
        key: 'hour',
        label: tt.hour,
        type: 'number',
        min: 0,
        max: 23.75,
        step: 0.25,
        unit: 'h',
        default: 12,
      },
      { key: 'day', label: tt.day, type: 'number', min: 1, max: 31, step: 1, default: 21 },
      {
        key: 'month',
        label: tt.month,
        type: 'select',
        options: tt.months.map((label, i) => ({ value: String(i + 1), label })),
        default: '6',
      },
    ],
    onActivate(env) {
      const sim = store.simTime.value;
      const l = localFromTime(sim.live ? Date.now() : sim.timeMs, env.focus().lon);
      env.setParams({ hour: l.hour, day: l.day, month: String(l.month) });
    },
    onParams(params, env) {
      const sim = store.simTime.value;
      const lon = env.focus().lon;
      const year = localFromTime(sim.live ? Date.now() : sim.timeMs, lon).year;
      const timeMs = timeFromLocal(
        year,
        Number(params.month) || 6,
        num(params.day, 21),
        num(params.hour, 12),
        lon,
      );
      store.simTime.value = { timeMs, live: false };
    },
  };
}
