import { useEffect, useRef } from 'preact/hooks';
import { store, updateSettings } from '../core/store';
import { t } from './i18n';

/** Bestätigen: Hinweis gespeichert, Werkzeug bleibt gewählt. */
function acknowledge(): void {
  updateSettings({ apocalypseHintSeen: true });
  store.apocalypseHint.value = false;
}

/** Hinweis-Dialog beim ersten Einsatz eines Werkzeugs der Stufe 5 (Spec 8). */
export function ApocalypseHint() {
  const open = store.apocalypseHint.value;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class="settings-dialog hint-dialog"
      data-testid="apocalypse-hint"
      aria-labelledby="apocalypse-hint-title"
      // Esc schließt wie „Verstanden“: der Hinweis ist gelesen
      onCancel={acknowledge}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          acknowledge();
        }}
      >
        <h2 id="apocalypse-hint-title">{t.tools.hint.title}</h2>
        <p>{t.tools.hint.text}</p>
        <div class="actions">
          <button type="submit" class="primary" data-testid="apocalypse-hint-ok" autofocus>
            {t.tools.hint.ok}
          </button>
        </div>
      </form>
    </dialog>
  );
}
