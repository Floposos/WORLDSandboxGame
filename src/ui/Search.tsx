import { useEffect, useRef, useState } from 'preact/hooks';
import { store } from '../core/store';
import { Geocoder, SEARCH_DEBOUNCE_MS, type GeocodeResult } from '../world/geocoder';
import { syncAttributions } from './attributions';
import { t } from './i18n';

const geocoder = new Geocoder({ lang: 'de' });

/** Sobald gesucht wurde, nennt die Attributionsleiste den Geocoder (Photon bzw. Nominatim). */
const SEARCH_ATTRIBUTION = [
  {
    id: 'osm',
    text: 'Suche: Photon by Komoot / Nominatim · © OpenStreetMap-Mitwirkende',
    url: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL',
  },
];

/** Ortssuche oben links: Photon (Fallback Nominatim), Debounce 400 ms, Tastatur bedienbar. */
export function Search() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  // Strg+K oder / fokussiert die Suche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable]') !== null;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounce + Abbruch veralteter Anfragen
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setStatus('loading');
      syncAttributions('search', SEARCH_ATTRIBUTION);
      geocoder
        .search(q, ctrl.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
          setStatus(r.length === 0 ? 'empty' : 'idle');
          setOpen(true);
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          console.warn('[search]', err instanceof Error ? err.message : err);
          setResults([]);
          setStatus('error');
          setOpen(true);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const choose = (r: GeocodeResult | undefined): void => {
    if (!r) return;
    setOpen(false);
    setQuery(r.name || r.label);
    inputRef.current?.blur();
    void store.api.value?.flyToResult(r);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const listId = 'search-results';
  const showList = open && (results.length > 0 || status === 'empty' || status === 'error');
  return (
    <div class="search" role="search">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={t.search.placeholder}
        aria-label={t.search.label}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `search-opt-${active}` : undefined}
        aria-busy={status === 'loading'}
        data-testid="search-input"
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showList ? (
        <ul id={listId} class="search-results" role="listbox" aria-label={t.search.results}>
          {status === 'empty' ? <li class="search-info">{t.search.noResults}</li> : null}
          {status === 'error' ? <li class="search-info">{t.search.error}</li> : null}
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lon},${i}`}
              id={`search-opt-${i}`}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <strong>{r.name}</strong>
              {r.label !== r.name ? <span>{r.label}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
