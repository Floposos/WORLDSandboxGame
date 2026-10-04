import { store } from '../core/store';
import { Stats } from './Stats';
import { TimeControl } from './TimeControl';
import { t } from './i18n';

function formatDistance(m: number): string {
  const abs = Math.abs(m);
  if (abs >= 100_000) return `${Math.round(m / 1000).toLocaleString('de-DE')} km`;
  if (abs >= 10_000)
    return `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
  if (abs < 10) return `${m.toLocaleString('de-DE', { maximumFractionDigits: 1 })} m`;
  return `${Math.round(m).toLocaleString('de-DE')} m`;
}

function formatCoord(v: number, pos: string, neg: string): string {
  return `${Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}° ${v >= 0 ? pos : neg}`;
}

/** HUD oben rechts: Ortsname, Koordinaten, Höhe, Quelle, Uhrzeit, Leistung. */
export function Hud() {
  const view = store.view.value;
  const provider = store.provider.value;
  const place = store.placeName.value;
  const providerName =
    provider === 'loading'
      ? t.provider.loading
      : provider === 'error'
        ? t.provider.reasons.network
        : t.provider.names[provider];
  return (
    <div class="hud">
      <div class="hud-panel" data-testid="hud">
        {place && view && view.height < 400_000 ? <div class="hud-place">{place}</div> : null}
        {view ? (
          <div class="hud-coords">
            {formatCoord(view.lat, 'N', 'S')}, {formatCoord(view.lon, 'O', 'W')}
          </div>
        ) : null}
        {view ? (
          <div>
            {t.hud.altitude} {formatDistance(view.height)}
            {view.ground !== null && view.height < 200_000
              ? ` · ${formatDistance(view.height - view.ground)} ${t.hud.aboveGround}`
              : ''}
          </div>
        ) : null}
        <div class="hud-dim" data-testid="provider">
          {t.hud.source}: {providerName}
        </div>
        {store.timeScale.value === 0 ? (
          <div class="hud-paused" data-testid="paused">
            {t.hud.paused}
          </div>
        ) : store.timeScale.value < 1 ? (
          <div class="hud-paused">{t.hud.slowMotion}</div>
        ) : null}
        <TimeControl />
      </div>
      <Stats />
    </div>
  );
}
