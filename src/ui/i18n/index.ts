import { de, type Messages } from './de';
import { en } from './en';

const catalogs: Record<string, Messages> = { de, en };

function detect(): string {
  // SIMPLIFIED: Die UI ist laut Spezifikation deutsch. Englisch nur per ?lang=en,
  // eine Sprachwahl in den Einstellungen kommt mit M7.
  try {
    const lang = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
    if (lang && lang in catalogs) return lang;
  } catch {
    /* ignorieren */
  }
  return 'de';
}

export const t: Messages = catalogs[detect()] ?? de;
