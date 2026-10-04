/** Geohash (Base32) für die Zellen des Gebäude-Caches (Spec 5.4: Schlüssel = Geohash Präzision 6). */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Kodiert eine Position als Geohash der Länge `precision`. */
export function geohashEncode(lat: number, lon: number, precision = 6): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch <<= 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Grenzen einer Geohash-Zelle. */
export function geohashBounds(hash: string): Bounds {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new Error(`Ungültiges Geohash-Zeichen: ${c}`);
    for (let b = 4; b >= 0; b--) {
      const bit = (v >> b) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (bit) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { south: latMin, west: lonMin, north: latMax, east: lonMax };
}

const M_PER_DEG_LAT = 111_320;

/**
 * Alle Zellen, die einen Kreis (Radius in m) um die Position berühren, sortiert nach Abstand
 * ihres Mittelpunkts zur Position (nächste zuerst).
 */
export function cellsCovering(lat: number, lon: number, radiusM: number, precision = 6): string[] {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const probe = geohashBounds(geohashEncode(lat, lon, precision));
  const stepLat = (probe.north - probe.south) / 2;
  const stepLon = (probe.east - probe.west) / 2;
  const cells = new Map<string, number>();
  for (let la = lat - dLat; la <= lat + dLat + stepLat; la += stepLat) {
    for (let lo = lon - dLon; lo <= lon + dLon + stepLon; lo += stepLon) {
      const cla = Math.min(la, lat + dLat);
      const clo = Math.min(lo, lon + dLon);
      const h = geohashEncode(Math.max(-90, Math.min(90, cla)), clo, precision);
      if (cells.has(h)) continue;
      const b = geohashBounds(h);
      // Abstand vom Kreismittelpunkt zum nächsten Punkt der Zelle
      const nla = Math.max(b.south, Math.min(b.north, lat));
      const nlo = Math.max(b.west, Math.min(b.east, lon));
      const dy = (nla - lat) * M_PER_DEG_LAT;
      const dx = (nlo - lon) * M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
      if (Math.hypot(dx, dy) > radiusM) continue;
      const cy = ((b.north + b.south) / 2 - lat) * M_PER_DEG_LAT;
      const cx = ((b.east + b.west) / 2 - lon) * M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
      cells.set(h, Math.hypot(cx, cy));
    }
  }
  return [...cells.entries()].sort((a, b) => a[1] - b[1]).map(([h]) => h);
}

/** Umschließendes Rechteck mehrerer Zellen. */
export function unionBounds(hashes: readonly string[]): Bounds {
  const out: Bounds = { south: 90, west: 180, north: -90, east: -180 };
  for (const h of hashes) {
    const b = geohashBounds(h);
    out.south = Math.min(out.south, b.south);
    out.west = Math.min(out.west, b.west);
    out.north = Math.max(out.north, b.north);
    out.east = Math.max(out.east, b.east);
  }
  return out;
}
