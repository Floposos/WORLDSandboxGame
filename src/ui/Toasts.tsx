import { dismissToast, store } from '../core/store';
import { t } from './i18n';

export function Toasts() {
  return (
    <div class="toasts" role="log" aria-live="polite">
      {store.toasts.value.map((toast) => (
        <div key={toast.id} class={`toast toast-${toast.kind}`}>
          <span>{toast.text}</span>
          <button type="button" aria-label={t.toast.close} onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
