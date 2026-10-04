/**
 * Höhen- und Farbregeln für OSM-Gebäude (Spec 5.4). Reine Funktionen, unit-getestet.
 */

/** Meter pro Geschoss laut Spec. */
export const LEVEL_HEIGHT_M = 3.2;
/** Plausibilitätsgrenze: höher ist kein Gebäude (Burj Khalifa: 828 m). */
const MAX_HEIGHT_M = 1_000;

export type Tags = Readonly<Record<string, string>>;

/**
 * Liest eine OSM-Längenangabe in Metern: „12“, „12 m“, „12,5“, „40'“, „40 ft“, „12'6\"“.
 * Liefert null bei Unsinn (nicht positiv, über 1000 m, unlesbar).
 */
export function parseLength(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const v = raw.trim().toLowerCase().replace(',', '.');
  let m: number;
  const feetInches = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(v);
  const withUnit = /^(-?\d+(?:\.\d+)?)\s*(m|meter|metres|meters|ft|feet)?$/.exec(v);
  if (feetInches) {
    m = Number(feetInches[1]) * 0.3048 + Number(feetInches[2] ?? 0) * 0.0254;
  } else if (withUnit) {
    m = Number(withUnit[1]);
    if (withUnit[2] === 'ft' || withUnit[2] === 'feet') m *= 0.3048;
  } else {
    return null;
  }
  return Number.isFinite(m) && m > 0 && m <= MAX_HEIGHT_M ? m : null;
}

/** Geschosszahl („5“, „3.5“, „3;4“ → größter Wert); null bei Unsinn. */
export function parseLevels(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let best: number | null = null;
  for (const part of raw.split(';')) {
    const n = Number(part.trim().replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n < 300) best = best === null ? n : Math.max(best, n);
  }
  return best;
}

/** Standardhöhe nach Gebäudetyp (Spec: Wohnhaus 9 m, Industrie 8 m, Kirche 20 m). */
export function defaultHeight(tags: Tags): number {
  const t = tags.building ?? tags['building:part'] ?? 'yes';
  switch (t) {
    case 'skyscraper':
      return 120;
    case 'tower':
    case 'transformer_tower':
      return 30;
    case 'church':
    case 'cathedral':
    case 'mosque':
    case 'temple':
    case 'synagogue':
      return 20;
    case 'chapel':
      return 10;
    case 'commercial':
    case 'office':
    case 'hotel':
    case 'hospital':
    case 'university':
    case 'government':
    case 'public':
    case 'civic':
      return 15;
    case 'retail':
    case 'supermarket':
    case 'school':
    case 'train_station':
    case 'stadium':
    case 'sports_hall':
      return 10;
    case 'industrial':
    case 'warehouse':
    case 'factory':
    case 'manufacture':
    case 'hangar':
      return 8;
    case 'garage':
    case 'garages':
    case 'shed':
    case 'carport':
    case 'hut':
    case 'kiosk':
    case 'cabin':
    case 'container':
    case 'service':
    case 'toilets':
    case 'roof':
      return 3;
    default:
      // house, residential, apartments, detached, terrace, yes …
      return 9;
  }
}

export interface BuildingHeights {
  /** Oberkante über dem Fußpunkt in m. */
  height: number;
  /** Unterkante über dem Fußpunkt in m (Überbauungen, Brückenhäuser, Dächer). */
  minHeight: number;
}

/**
 * Höhe nach Spec 5.4: `height` → `building:levels × 3,2 m` → Standard nach Typ.
 * Unterkante aus `min_height` oder `building:min_level × 3,2 m`. Ein Vordach (`building=roof`)
 * ohne Angabe schwebt 1 m dick unter seiner Oberkante.
 */
export function buildingHeights(tags: Tags): BuildingHeights {
  const levels = parseLevels(tags['building:levels']);
  const roofLevels = parseLevels(tags['roof:levels']) ?? 0;
  let height =
    parseLength(tags.height) ??
    (levels !== null && levels > 0 ? (levels + roofLevels * 0.5) * LEVEL_HEIGHT_M : null) ??
    defaultHeight(tags);
  const minLevel = parseLevels(tags['building:min_level']);
  let minHeight =
    parseLength(tags.min_height) ?? (minLevel !== null ? minLevel * LEVEL_HEIGHT_M : 0);
  if (minHeight === 0 && (tags.building === 'roof' || tags['building:part'] === 'roof')) {
    minHeight = Math.max(0, height - 1);
  }
  if (height <= minHeight) height = minHeight + LEVEL_HEIGHT_M;
  return { height, minHeight };
}

/** Benannte Farben, wie sie in OSM vorkommen. */
const NAMED: Record<string, number> = {
  white: 0xf2f2ef,
  black: 0x2b2b2b,
  grey: 0x9a9a9a,
  gray: 0x9a9a9a,
  darkgrey: 0x5f5f5f,
  darkgray: 0x5f5f5f,
  lightgrey: 0xcfcfcf,
  lightgray: 0xcfcfcf,
  silver: 0xc0c0c0,
  red: 0xa8423a,
  darkred: 0x7a2a24,
  brown: 0x8b5a3c,
  maroon: 0x7a2e2e,
  orange: 0xd98a46,
  yellow: 0xe8d47a,
  beige: 0xe6dcc4,
  cream: 0xf1e8cf,
  tan: 0xd2b48c,
  green: 0x6f8f5a,
  darkgreen: 0x3f5a35,
  blue: 0x5a7fa8,
  lightblue: 0x9fc3df,
  navy: 0x2c3e66,
  pink: 0xe2a9b3,
  sandybrown: 0xf4a460,
  terracotta: 0xb5583c,
};

/** Liest `#rgb`, `#rrggbb` oder einen Farbnamen; null, wenn unbekannt. */
export function parseColour(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return parseInt(h, 16);
  }
  return NAMED[v] ?? null;
}

const WALL_MATERIAL: Record<string, number> = {
  brick: 0xa45d45,
  concrete: 0xbab6ad,
  glass: 0x8aa4b8,
  plaster: 0xe6ded0,
  stone: 0xc8bba0,
  sandstone: 0xd4c19a,
  limestone: 0xddd3bd,
  wood: 0x8f6c4b,
  metal: 0xa3a8ab,
  steel: 0xa3a8ab,
  timber_framing: 0xd9cdb5,
  cement_block: 0xb3afa6,
};

const ROOF_MATERIAL: Record<string, number> = {
  roof_tiles: 0x9c4a35,
  tile: 0x9c4a35,
  tiles: 0x9c4a35,
  metal: 0x878d92,
  copper: 0x5f9b84,
  concrete: 0xa29f98,
  gravel: 0x97938b,
  glass: 0x9db6c6,
  slate: 0x575c63,
  tar_paper: 0x5c5c5c,
  asphalt: 0x5c5c5c,
  grass: 0x6f8f5a,
  plants: 0x6f8f5a,
};

/** Neutrale Fassadenpalette (hell, leicht warm), Auswahl stabil nach OSM-ID. */
const WALL_PALETTE = [0xe4ded3, 0xd8d2c6, 0xcfc9bd, 0xe9e4da, 0xd2cabb, 0xc7c3bb, 0xded6c8];
const ROOF_PALETTE = [0x8d8984, 0x7f7b76, 0x96918a, 0x86817a, 0x9a8f85];

function pick(palette: readonly number[], id: number): number {
  // Knuth-Hash, damit benachbarte IDs unterschiedliche Töne bekommen
  return palette[Math.abs(Math.imul(id, 2654435761) >>> 0) % palette.length]!;
}

/** Fassaden- und Dachfarbe aus `building:colour`/`building:material` bzw. `roof:colour`/`roof:material`. */
export function buildingColours(tags: Tags, id: number): { wall: number; roof: number } {
  const wall =
    parseColour(tags['building:colour'] ?? tags.colour) ??
    WALL_MATERIAL[tags['building:material'] ?? ''] ??
    pick(WALL_PALETTE, id);
  const roof =
    parseColour(tags['roof:colour']) ??
    ROOF_MATERIAL[tags['roof:material'] ?? ''] ??
    pick(ROOF_PALETTE, id);
  return { wall, roof };
}
