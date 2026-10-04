import { useState } from 'preact/hooks';
import { activeAttributions } from './attributions';
import { t } from './i18n';

/** Attributionsleiste unten rechts, kompakt mit aufklappbaren Details. */
export function Attribution() {
  const [open, setOpen] = useState(false);
  const entries = activeAttributions.value;
  const summary = entries.length > 0 ? entries.map((e) => e.text).join(' · ') : t.attribution.none;
  return (
    <footer class="attribution" data-testid="attribution">
      <button
        type="button"
        class="attribution-toggle"
        aria-expanded={open}
        aria-label={t.attribution.toggle}
        onClick={() => setOpen(!open)}
      >
        {t.attribution.label}
      </button>
      {open ? (
        <ul>
          {entries.length === 0 ? <li>{t.attribution.none}</li> : null}
          {entries.map((e) => (
            <li key={e.id}>
              {e.url ? (
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  {e.text}
                </a>
              ) : (
                e.text
              )}
              {e.license ? ` (${e.license})` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <span class="attribution-summary">{summary}</span>
      )}
    </footer>
  );
}
