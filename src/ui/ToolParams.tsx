import { setToolParam, store } from '../core/store';
import type { ToolParam } from '../tools/Tool';
import { t } from './i18n';

function format(v: number, p: ToolParam): string {
  const digits = (p.step ?? 1) < 1 ? 1 : 0;
  const s = v.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return p.unit ? `${s} ${p.unit}` : s;
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
              />
            </label>
          );
        }
        if (p.type === 'boolean') {
          return (
            <label key={p.key} for={inputId} class="tool-param tool-param-check">
              <input
                id={inputId}
                type="checkbox"
                checked={v === true}
                onChange={(e) => setToolParam(tool.id, p.key, e.currentTarget.checked)}
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
              onChange={(e) => setToolParam(tool.id, p.key, e.currentTarget.value)}
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
