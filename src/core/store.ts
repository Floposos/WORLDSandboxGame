import { signal } from '@preact/signals';
import type { TimeScale } from './constants';
import { loadSettings, type Settings } from './settings';

/**
 * Globaler Spielzustand als Preact-Signals. Die UI liest direkt daraus,
 * die Engine schreibt hinein. Hot-Path-Daten (Transforms, Partikel) leben
 * NICHT hier, sondern in den jeweiligen Systemen.
 */
export const store = {
  settings: signal<Settings>(loadSettings()),
  timeScale: signal<TimeScale>(1),
  activeToolId: signal<string | null>(null),
  stats: signal({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, particles: 0 }),
  toasts: signal<Toast[]>([]),
};

export interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'error';
  text: string;
}

let toastId = 0;

export function pushToast(kind: Toast['kind'], text: string, ttlMs = 6000): void {
  const toast: Toast = { id: ++toastId, kind, text };
  store.toasts.value = [...store.toasts.value.slice(-4), toast];
  setTimeout(() => dismissToast(toast.id), ttlMs);
}

export function dismissToast(id: number): void {
  store.toasts.value = store.toasts.value.filter((t) => t.id !== id);
}
