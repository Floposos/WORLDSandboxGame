import { armyCommand, store, updateSettings } from '../core/store';
import { UNIT_TYPES, type UnitType } from '../game/units';
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

const UNIT_ICONS: Record<UnitType, string> = {
  infantry: 'M5 6l14 12M19 6L5 18',
  tank: 'M7 9h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6z',
  air: 'M12 12c-2-4-7-4-7 0s5 4 7 0c2 4 7 4 7 0s-5-4-7 0z',
};

/** Knopf „Truppen“ (Taste U) neben dem Kartenknopf. */
export function ArmyToggle() {
  const on = store.army.value.mode !== 'off';
  return (
    <button
      type="button"
      class="army-toggle"
      aria-pressed={on}
      aria-label={t.army.open}
      title={`${t.army.open} (U)`}
      data-testid="army-toggle"
      onClick={(e) => {
        e.currentTarget.blur();
        store.army.value = { ...store.army.value, mode: on ? 'off' : 'command' };
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M5 21V4m0 0h11l-2 4 2 4H5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}

/** Truppen-Panel: Befehlen oder Einheiten setzen, Auswahl einem Land zuweisen. */
export function ArmyPanel() {
  const army = store.army.value;
  if (army.mode === 'off') return null;
  const sel = store.armySelection.value;
  const count = store.unitCount.value;
  const set = (patch: Partial<typeof army>): void => {
    store.army.value = { ...army, ...patch };
  };
  const ownerValue = sel.mixed ? '__mixed' : (sel.owner ?? '');
  return (
    <section class="army-panel" data-testid="army-panel" aria-label={t.army.title}>
      <header>
        <h2>{t.army.title}</h2>
        <span class="army-total">{t.army.total.replace('{n}', fmt(count))}</span>
      </header>
      <div class="army-modes" role="group">
        <button
          type="button"
          aria-pressed={army.mode === 'command'}
          data-testid="army-command"
          onClick={(e) => {
            e.currentTarget.blur();
            set({ mode: 'command' });
          }}
        >
          {t.army.command}
        </button>
        {UNIT_TYPES.map((u) => (
          <button
            key={u}
            type="button"
            title={t.army.types[u]}
            aria-label={t.army.types[u]}
            aria-pressed={army.mode === 'place' && army.placeType === u}
            data-testid={`army-place-${u}`}
            onClick={(e) => {
              e.currentTarget.blur();
              set({ mode: 'place', placeType: u });
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <rect
                x="2"
                y="4"
                width="20"
                height="16"
                rx="1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path d={UNIT_ICONS[u]} fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </button>
        ))}
      </div>
      <p class="army-hint">{army.mode === 'command' ? t.army.commandHint : t.army.placeHint}</p>
      {store.cameraMode.value !== 'globe' && (
        <p class="army-hint army-warn" data-testid="army-globe-only">
          {t.army.globeOnly}
        </p>
      )}
      {sel.ids.length > 0 && (
        <div class="army-selection" data-testid="army-selection">
          <p>
            {t.army.selected.replace('{n}', String(sel.ids.length))}
            {': '}
            {UNIT_TYPES.filter((u) => sel.byType[u] > 0)
              .map((u) => `${sel.byType[u]} ${t.army.types[u]}`)
              .join(', ')}
            {sel.moving > 0 && ` · ${t.army.moving.replace('{n}', String(sel.moving))}`}
          </p>
          <label>
            {t.army.owner}
            <select
              data-testid="army-owner"
              value={ownerValue}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v !== '__mixed') armyCommand({ kind: 'assign', owner: v || null });
                e.currentTarget.blur();
              }}
            >
              {sel.mixed && <option value="__mixed">{t.army.mixed}</option>}
              <option value="">{t.army.noOwner}</option>
              {store.countryList.value.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div class="army-actions">
            <button type="button" onClick={() => armyCommand({ kind: 'stop' })}>
              {t.army.stop}
            </button>
            <button
              type="button"
              data-testid="army-remove"
              onClick={() => armyCommand({ kind: 'delete' })}
            >
              {t.army.remove}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
