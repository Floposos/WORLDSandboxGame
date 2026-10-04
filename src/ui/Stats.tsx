import { store } from '../core/store';
import { t } from './i18n';

/** Kompakte Leistungsanzeige (FPS, Frame-Zeit, Draw-Calls, Dreiecke). */
export function Stats() {
  const s = store.stats.value;
  if (!store.settings.value.showFps) return null;
  return (
    <div class="stats" role="status" aria-live="off" data-testid="stats">
      <span>
        <strong data-testid="fps">{s.fps.toFixed(0)}</strong> {t.hud.fps}
      </span>
      <span>
        {s.frameMs.toFixed(1)} {t.hud.frameMs}
      </span>
      <span>
        {s.drawCalls} {t.hud.drawCalls}
      </span>
      <span>
        {s.triangles.toLocaleString('de-DE')} {t.hud.triangles}
      </span>
      <span data-testid="bodies">
        {s.bodies} {t.hud.bodies}
      </span>
      <span data-testid="buildings">
        {store.buildingCount.value.toLocaleString('de-DE')} {t.hud.buildings}
      </span>
    </div>
  );
}
