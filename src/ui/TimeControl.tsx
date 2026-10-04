import { store } from '../core/store';
import { t } from './i18n';

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Zeitregler für den Sonnenstand (Datum/Uhrzeit, „Jetzt“ kehrt zur Echtzeit zurück). */
export function TimeControl() {
  const sim = store.simTime.value;
  const shown = sim.live ? Date.now() : sim.timeMs;
  return (
    <div class="time-control">
      <input
        type="datetime-local"
        aria-label={t.time.label}
        value={toLocalInput(shown)}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value;
          const ms = new Date(v).getTime();
          if (Number.isFinite(ms)) store.simTime.value = { timeMs: ms, live: false };
        }}
      />
      <button
        type="button"
        aria-pressed={sim.live}
        onClick={() => (store.simTime.value = { timeMs: Date.now(), live: true })}
      >
        {sim.live ? t.time.live : t.time.now}
      </button>
    </div>
  );
}
