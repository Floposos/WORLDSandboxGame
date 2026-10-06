import { pushToast, store } from '../core/store';
import { t } from './i18n';

/** „Welt zurücksetzen“ über die Engine, mit Rückmeldung. */
export function resetWorld(): void {
  const api = store.api.value;
  if (!api) return;
  void api.resetWorld().then(() => pushToast('info', t.tools.resetDone, 3000));
}

/**
 * Filmische Sequenz (Mond-Absturz): Kinobalken, Untertitel und am Ende das Reset-Angebot
 * (Spec 8). Die Balken lassen Klicks durch, nur die Knöpfe fangen sie ab.
 */
export function Cinematic() {
  const c = store.cinematic.value;
  if (!c) return null;
  return (
    <div class="cinematic" data-testid="cinematic">
      <div class="cinematic-bar top" />
      <div class="cinematic-bar bottom">
        <div class="cinematic-caption" role="status" aria-live="polite">
          <strong>{c.caption}</strong>
          {c.detail ? <span>{c.detail}</span> : null}
        </div>
        {c.offerReset ? (
          <div class="cinematic-actions">
            <button
              type="button"
              class="primary"
              data-testid="cinematic-reset"
              onClick={resetWorld}
            >
              {t.tools.reset}
            </button>
            <button
              type="button"
              data-testid="cinematic-close"
              onClick={() => (store.cinematic.value = null)}
            >
              {t.tools.keepWatching}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Globaler Knopf „Welt zurücksetzen“ neben dem Zahnrad (Spec 8, globale Werkzeuge). */
export function ResetButton() {
  return (
    <button
      type="button"
      class="reset-button"
      aria-label={t.tools.reset}
      title={`${t.tools.reset}: ${t.tools.resetTitle}`}
      data-testid="reset-world"
      onClick={resetWorld}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}
