import { signal } from '@preact/signals';
import type { AttributionEntry } from '../core/types';

export type { AttributionEntry };

/** Aktuell aktive Quellen. Provider tragen sich ein, sobald ihre Daten sichtbar sind. */
export const activeAttributions = signal<AttributionEntry[]>([]);

export function setAttributions(owner: string, entries: AttributionEntry[]): void {
  const others = activeAttributions.value.filter((e) => !e.id.startsWith(`${owner}:`));
  activeAttributions.value = [...others, ...entries.map((e) => ({ ...e, id: `${owner}:${e.id}` }))];
}

/** Ersetzt die Einträge eines Besitzers nur, wenn sie sich geändert haben (spart Re-Renders). */
export function syncAttributions(owner: string, entries: AttributionEntry[]): void {
  const prefix = `${owner}:`;
  const current = activeAttributions.value.filter((e) => e.id.startsWith(prefix));
  const same =
    current.length === entries.length &&
    current.every((e, i) => e.text === entries[i]?.text && e.imageUrl === entries[i]?.imageUrl);
  if (!same) setAttributions(owner, entries);
}
