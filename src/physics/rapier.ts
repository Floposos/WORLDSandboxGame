/**
 * Rapier per Lazy Load (Spec M3): Das WASM-Modul (~2 MB) wird erst geladen, wenn die Physik
 * gebraucht wird (erstes Werkzeug). `rapier3d-compat` bettet das WASM als Base64 ein und
 * funktioniert daher auch auf GitHub Pages ohne eigenen WASM-MIME-Typ.
 */
import type RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

let loading: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  loading ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    const R = mod.default;
    await R.init();
    return R;
  });
  return loading;
}
