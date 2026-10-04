import { pushToast } from '../core/store';
import { t } from './i18n';

/**
 * Globaler Fehlerfang: Statt eines weißen Bildschirms erscheint ein Toast.
 * Gleiche Meldungen werden kurz entprellt, damit ein Fehler im Render-Loop
 * nicht 60 Toasts pro Sekunde erzeugt.
 */
export function installErrorBoundary(): void {
  let lastText = '';
  let lastAt = 0;
  const report = (err: unknown): void => {
    const detail = err instanceof Error ? err.message : String(err);
    const text = `${t.toast.unexpectedError} (${detail})`;
    const now = performance.now();
    if (text === lastText && now - lastAt < 5000) return;
    lastText = text;
    lastAt = now;
    console.error('[globebox]', err);
    pushToast('error', text);
  };
  window.addEventListener('error', (e) => report(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}
