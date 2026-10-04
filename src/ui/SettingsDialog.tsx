import { useEffect, useRef, useState } from 'preact/hooks';
import type { PresetId, ProviderChoice, Settings } from '../core/settings';
import { pushToast, store, updateSettings } from '../core/store';
import { t } from './i18n';

const PROVIDER_CHOICES: ProviderChoice[] = ['auto', 'google', 'cesium-ion', 'open-data'];
const PRESET_IDS: PresetId[] = ['low', 'medium', 'high', 'ultra'];

/** Zahnrad-Knopf plus modaler Dialog für Kartenquelle, Keys und Grafik. */
export function SettingsDialog() {
  const open = store.keysDialogOpen.value;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Settings>(store.settings.value);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setDraft(store.settings.value);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const close = (): void => {
    store.keysDialogOpen.value = false;
  };

  const save = (e: Event): void => {
    e.preventDefault();
    const prev = store.settings.value;
    const keysChanged =
      prev.keys.googleMapsKey !== draft.keys.googleMapsKey ||
      prev.keys.cesiumIonToken !== draft.keys.cesiumIonToken ||
      prev.provider !== draft.provider;
    const stored = updateSettings({
      ...draft,
      keys: {
        googleMapsKey: draft.keys.googleMapsKey.trim(),
        cesiumIonToken: draft.keys.cesiumIonToken.trim(),
      },
    });
    pushToast(stored ? 'info' : 'warn', stored ? t.settings.saved : t.settings.notSaved);
    close();
    if (keysChanged) void store.api.value?.restartProviders();
  };

  const nameOf = (c: ProviderChoice): string =>
    c === 'auto' ? t.settings.providerAuto : t.provider.names[c];

  return (
    <>
      <button
        type="button"
        class="settings-button"
        aria-label={t.settings.open}
        title={t.settings.open}
        data-testid="settings-open"
        onClick={() => (store.keysDialogOpen.value = true)}
      >
        ⚙
      </button>
      <dialog
        ref={dialogRef}
        class="settings-dialog"
        aria-labelledby="settings-title"
        onClose={close}
        onCancel={close}
      >
        <form onSubmit={save}>
          <h2 id="settings-title">{t.settings.title}</h2>
          <label>
            {t.settings.providerLabel}
            <select
              value={draft.provider}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  provider: (e.target as HTMLSelectElement).value as ProviderChoice,
                })
              }
            >
              {PROVIDER_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {nameOf(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.settings.googleKey}
            <input
              type="password"
              autocomplete="off"
              spellcheck={false}
              data-testid="google-key"
              value={draft.keys.googleMapsKey}
              onInput={(e) =>
                setDraft({
                  ...draft,
                  keys: { ...draft.keys, googleMapsKey: (e.target as HTMLInputElement).value },
                })
              }
            />
          </label>
          <label>
            {t.settings.cesiumToken}
            <input
              type="password"
              autocomplete="off"
              spellcheck={false}
              value={draft.keys.cesiumIonToken}
              onInput={(e) =>
                setDraft({
                  ...draft,
                  keys: { ...draft.keys, cesiumIonToken: (e.target as HTMLInputElement).value },
                })
              }
            />
          </label>
          <p class="hint">{t.settings.keysHint}</p>
          <label>
            {t.settings.preset}
            <select
              value={draft.preset}
              onChange={(e) =>
                setDraft({ ...draft, preset: (e.target as HTMLSelectElement).value as PresetId })
              }
            >
              {PRESET_IDS.map((p) => (
                <option key={p} value={p}>
                  {t.settings.presets[p]}
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={draft.reduceMotion}
              onChange={(e) =>
                setDraft({ ...draft, reduceMotion: (e.target as HTMLInputElement).checked })
              }
            />
            {t.settings.reduceMotion}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={draft.showFps}
              onChange={(e) =>
                setDraft({ ...draft, showFps: (e.target as HTMLInputElement).checked })
              }
            />
            {t.settings.showFps}
          </label>
          <label>
            {t.settings.volume} ({Math.round(draft.masterVolume * 100)} %)
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              data-testid="volume"
              value={draft.masterVolume}
              onInput={(e) =>
                setDraft({ ...draft, masterVolume: Number((e.target as HTMLInputElement).value) })
              }
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              data-testid="mute"
              checked={draft.muted}
              onChange={(e) =>
                setDraft({ ...draft, muted: (e.target as HTMLInputElement).checked })
              }
            />
            {t.settings.mute}
          </label>
          <div class="actions">
            <button type="button" onClick={close}>
              {t.settings.cancel}
            </button>
            <button type="submit" class="primary" data-testid="settings-save">
              {t.settings.save}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
