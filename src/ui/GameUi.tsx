import { store, updateSettings } from '../core/store';
import { t } from './i18n';

const fmt = (n: number): string => Math.round(n).toLocaleString(t.locale);

/** Knopf „Politische Karte“ (Taste G) neben dem Zahnrad. */
export function MapToggle() {
  const on = store.settings.value.politicalMap;
  return (
    <button
      type="button"
      class="map-toggle"
      aria-pressed={on}
      aria-label={t.game.mapToggle}
      title={`${t.game.mapToggle} (G)`}
      data-testid="map-toggle"
      onClick={(e) => {
        e.currentTarget.blur();
        updateSettings({ politicalMap: !on });
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}

/** Ländernamen auf der Karte (Positionen aus der Engine). */
export function CountryLabels() {
  if (!store.settings.value.politicalMap) return null;
  return (
    <div class="country-labels" aria-hidden="true" data-testid="country-labels">
      {store.countryLabels.value.map((l) => (
        <span
          key={l.id}
          class="country-label"
          style={{
            transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)`,
            fontSize: `${l.size}px`,
          }}
        >
          {l.name}
        </span>
      ))}
    </div>
  );
}

/** Steckbrief des gewählten Landes. */
export function CountryPanel() {
  const c = store.selectedCountry.value;
  if (!c || !store.settings.value.politicalMap) return null;
  return (
    <section class="country-panel" data-testid="country-panel" aria-label={t.game.country}>
      <header>
        <h2>{c.name}</h2>
        <button
          type="button"
          class="close"
          aria-label={t.game.close}
          onClick={() => (store.selectedCountry.value = null)}
        >
          ×
        </button>
      </header>
      <dl>
        {c.iso2 && (
          <>
            <dt>{t.game.iso}</dt>
            <dd>{c.iso2}</dd>
          </>
        )}
        <dt>{t.game.population}</dt>
        <dd>{fmt(c.population)}</dd>
        <dt>{t.game.area}</dt>
        <dd>{fmt(c.areaKm2)} km²</dd>
      </dl>
    </section>
  );
}
