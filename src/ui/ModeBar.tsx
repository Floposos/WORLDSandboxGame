import { CAMERA_MODES } from '../camera/types';
import { store } from '../core/store';
import { t } from './i18n';

/** Kameramodus-Leiste unten in der Mitte (Tasten 1–4) mit Steuerungshinweis. */
export function ModeBar() {
  const mode = store.cameraMode.value;
  return (
    <div class="mode-bar">
      <div class="mode-buttons" role="group" aria-label={t.camera.label}>
        {CAMERA_MODES.map((m, i) => (
          <button
            key={m}
            type="button"
            data-testid={`mode-${m}`}
            aria-pressed={mode === m}
            onClick={(e) => {
              e.currentTarget.blur();
              store.api.value?.setCameraMode(m);
            }}
          >
            <kbd>{i + 1}</kbd> {t.camera.modes[m]}
          </button>
        ))}
      </div>
      <div class="mode-hint" data-testid="mode-hint">
        {t.camera.hints[mode]}
      </div>
    </div>
  );
}
