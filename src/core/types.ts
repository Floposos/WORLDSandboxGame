/** Gemeinsame Basistypen. */

/** Schlanker 3D-Vektor ohne three.js-Abhängigkeit (für Events, Serialisierung, Tests). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Geodätischer Punkt auf WGS84. Winkel in Grad, Höhe in Metern über dem Ellipsoid. */
export interface GeoPoint {
  lat: number;
  lon: number;
  height: number;
}

export type Precipitation = 'none' | 'rain' | 'snow';

export interface WeatherState {
  preset: 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog';
  cloudCover: number; // 0..1
  precipitation: Precipitation;
  intensity: number; // 0..1
  windSpeedMs: number;
  windDirectionDeg: number; // meteorologisch: Herkunftsrichtung
  temperatureC: number;
}

/** Eine Quellenangabe für die Attributionsleiste. */
export interface AttributionEntry {
  id: string;
  /** Pflicht-Attributionstext der Quelle. */
  text: string;
  url?: string;
  license?: string;
  /** Logo, das sichtbar bleiben muss (z. B. Google). */
  imageUrl?: string;
}
