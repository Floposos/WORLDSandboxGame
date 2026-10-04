import { signal } from '@preact/signals';

export interface AttributionEntry {
  id: string;
  /** Pflicht-Attributionstext der Quelle. */
  text: string;
  url?: string;
  license?: string;
}

/** Aktuell aktive Quellen. Provider tragen sich ein, sobald ihre Daten sichtbar sind. */
export const activeAttributions = signal<AttributionEntry[]>([]);

export function setAttributions(owner: string, entries: AttributionEntry[]): void {
  const others = activeAttributions.value.filter((e) => !e.id.startsWith(`${owner}:`));
  activeAttributions.value = [...others, ...entries.map((e) => ({ ...e, id: `${owner}:${e.id}` }))];
}
