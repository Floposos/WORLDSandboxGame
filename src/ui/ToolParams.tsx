import { requestToolAction, setToolParam, store } from '../core/store';
import type { ToolParam } from '../tools/Tool';
import { t } from './i18n';

function format(v: number, p: ToolParam): string {
  if (p.format) return p.format(v);
  const step = p.step ?? 1;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const s = v.toLocaleString(t.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return p.unit ? `${s} ${p.unit}` : s;
}

/** Auf zwei geltende Ziffern runden (logarithmische Regler). */
export function roundSignificant(v: number): number {
  if (!(v > 0)) return 0;
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

/**
 * Nach einer Eingabe den Fokus an die Szene zurückgeben, damit Esc, 1–4 und F sofort wirken.
 * Enter übernimmt nur, Esc wählt das Werkzeug zusätzlich ab.
 */
function release(e: Event): void {
  (e.currentTarget as HTMLElement).blur();
}

function onParamKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') release(e);
  else if (e.key === 'Escape') {
    release(e);
    store.activeToolId.value = null;
  }
}

/** Parameter-Panel rechts für das aktive Werkzeug (Spec 10): Schieberegler mit Einheit. */
export function ToolParams() {
  const id = store.activeToolId.value;
  const tool = store.tools.value.find((x) => x.id === id);
  if (!tool) return null;
  const values = store.toolParams.value[tool.id] ?? {};
  return (
    <section class="tool-params" aria-label={t.tools.params} data-testid="tool-params">
      <header>
        <strong>{tool.name}</strong>
        <button
          type="button"
          class="tool-close"
          aria-label={t.tools.deselect}
          title={t.tools.deselect}
          onClick={() => (store.activeToolId.value = null)}
        >
          ×
        </button>
      </header>
      <p class="hud-dim">{tool.description}</p>
      {tool.params.map((p) => {
        const v = values[p.key] ?? p.default;
        const inputId = `param-${tool.id}-${p.key}`;
        if (p.type === 'number' && p.scale === 'log') {
          // Logarithmische Teilung: der Regler läuft über log10 des Werts
          // in 40 Schritten je Zehnerpotenz, damit runde Werte (100 kt, 1 Mt) genau auf dem Raster
          // liegen; das obere Ende wird auf das Raster aufgerundet und der Wert begrenzt.
          const lo = Math.log10(Math.max(1e-9, p.min ?? 1));
          const hi = lo + Math.ceil((Math.log10(Math.max(1e-9, p.max ?? 10)) - lo) * 40) / 40;
          const max = p.max ?? 10;
          return (
            <label key={p.key} for={inputId} class="tool-param">
              <span>
                {p.label} <output>{format(Number(v), p)}</output>
              </span>
              <input
                id={inputId}
                type="range"
                min={lo}
                max={hi}
                step={1 / 40}
                value={Math.log10(Math.max(1e-9, Number(v)))}
                onInput={(e) =>
                  setToolParam(
                    tool.id,
                    p.key,
                    Math.min(max, roundSignificant(10 ** Number(e.currentTarget.value))),
                  )
                }
                onPointerUp={release}
                onKeyDown={onParamKey}
              />
            </label>
          );
        }
        if (p.type === 'number') {
          return (
            <label key={p.key} for={inputId} class="tool-param">
              <span>
                {p.label} <output>{format(Number(v), p)}</output>
              </span>
              <input
                id={inputId}
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={Number(v)}
                onInput={(e) => setToolParam(tool.id, p.key, Number(e.currentTarget.value))}
                onPointerUp={release}
                onKeyDown={onParamKey}
              />
            </label>
          );
        }
        if (p.type === 'action') {
          const busy = store.toolBusy.value === `${tool.id}:${p.key}`;
          return (
            <button
              key={p.key}
              type="button"
              class="tool-action"
              data-testid={`action-${tool.id}-${p.key}`}
              disabled={busy}
              aria-busy={busy}
              onClick={(e) => {
                requestToolAction(tool.id, p.key);
                release(e);
              }}
            >
              {busy ? t.tools.working : p.label}
            </button>
          );
        }
        if (p.type === 'boolean') {
          return (
            <label key={p.key} for={inputId} class="tool-param tool-param-check">
              <input
                id={inputId}
                type="checkbox"
                checked={v === true}
                onChange={(e) => {
                  setToolParam(tool.id, p.key, e.currentTarget.checked);
                  release(e);
                }}
                onKeyDown={onParamKey}
              />
              <span>{p.label}</span>
            </label>
          );
        }
        return (
          <label key={p.key} for={inputId} class="tool-param">
            <span>{p.label}</span>
            <select
              id={inputId}
              value={String(v)}
              onChange={(e) => {
                setToolParam(tool.id, p.key, e.currentTarget.value);
                release(e);
              }}
              onKeyDown={onParamKey}
            >
              {p.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {store.physicsState.value === 'loading' ? (
        <p class="hud-dim">{t.tools.loadingPhysics}</p>
      ) : null}
    </section>
  );
}
