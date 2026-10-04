import { store } from '../core/store';
import type { ToolTier } from '../tools/Tool';
import { t } from './i18n';
import { ToolIcon } from './icons';

/** Farben der Stufen (Spec 10): grün → gelb → orange → rot → violett → schwarz-rot. */
export const TIER_COLORS: Record<ToolTier, string> = {
  0: '#4caf6a',
  1: '#e3c34a',
  2: '#ef8c35',
  3: '#e04848',
  4: '#9b59d0',
  5: '#7a1020',
};

/** Werkzeugleiste unten mittig, vollständig aus der Registry erzeugt (Spec 4.5, 10). */
export function Toolbar() {
  const tools = store.tools.value;
  const active = store.activeToolId.value;
  if (tools.length === 0) return null;
  const tiers = [...new Set(tools.map((x) => x.tier))].sort();
  return (
    <div class="toolbar" role="toolbar" aria-label={t.tools.toolbar} data-testid="toolbar">
      {tiers.map((tier) => (
        <div
          key={tier}
          class="tool-group"
          role="group"
          aria-label={t.tools.tiers[tier]}
          style={{ '--tier': TIER_COLORS[tier] }}
        >
          <span class="tool-group-label">{t.tools.tiers[tier]}</span>
          <div class="tool-group-buttons">
            {tools
              .filter((x) => x.tier === tier)
              .map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  class="tool-button"
                  data-testid={`tool-${tool.id}`}
                  aria-pressed={active === tool.id}
                  title={`${tool.name}: ${tool.description}`}
                  aria-label={tool.name}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    store.activeToolId.value = active === tool.id ? null : tool.id;
                  }}
                >
                  <ToolIcon name={tool.icon} />
                  <span class="tool-name">{tool.name}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
