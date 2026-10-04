import type { WebGLRenderer } from 'three';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { TerrariumMeshPlugin, TilesFadePlugin, XYZTilesOverlay } from '3d-tiles-renderer/plugins';
import type { Settings } from '../../core/settings';
import type { AttributionEntry } from '../../core/types';
import { TilesProviderBase } from './TilesProviderBase';

export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export interface ImagerySource {
  id: 'eox-s2cloudless-2016' | 'gibs-blue-marble';
  url: string;
  /** Anzahl Zoomstufen (maxZoom + 1). */
  levels: number;
  /** URL einer kleinen Kachel für den Verfügbarkeitstest. */
  probeUrl: string;
  attribution: AttributionEntry;
}

/** Bildquellen in Vorzugsreihenfolge (ADR-007, ADR-012). */
export const IMAGERY_SOURCES: readonly ImagerySource[] = [
  {
    id: 'eox-s2cloudless-2016',
    // WMTS RESTful, TileMatrixSet "g" = GoogleMapsCompatible (Web Mercator), Zeile = y, Spalte = x
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    levels: 16,
    probeUrl: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/0/0/0.jpg',
    attribution: {
      id: 'eox',
      text: 'Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)',
      url: 'https://s2maps.eu',
      license: 'CC BY 4.0',
    },
  },
  {
    id: 'gibs-blue-marble',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
    levels: 9,
    probeUrl:
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/0/0/0.jpeg',
    attribution: {
      id: 'gibs',
      text: "Imagery: NASA Global Imagery Browse Services (GIBS), part of NASA's ESDIS",
      url: 'https://earthdata.nasa.gov/gibs',
    },
  },
];

const TERRAIN_ATTRIBUTION: AttributionEntry = {
  id: 'terrain',
  text: 'Gelände: Terrain Tiles (Mapzen/Tilezen, AWS Open Data) – SRTM, GMTED2010, ETOPO1, NED, EU-DEM u. a.',
  url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
};

/** Erste erreichbare Bildquelle; fällt auf die letzte zurück, wenn keine antwortet. */
export async function pickImagery(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000,
): Promise<ImagerySource> {
  for (const source of IMAGERY_SOURCES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(source.probeUrl, { signal: ctrl.signal });
      if (res.ok) return source;
    } catch {
      /* nächste Quelle */
    } finally {
      clearTimeout(timer);
    }
  }
  return IMAGERY_SOURCES[IMAGERY_SOURCES.length - 1]!;
}

/**
 * Open-Data-Modus (immer verfügbar, kein Key): Gelände aus AWS-Terrarium-Kacheln über
 * `TerrariumMeshPlugin` (ADR-003), Satellitenbild als XYZ-Overlay.
 */
export class OpenDataProvider extends TilesProviderBase {
  readonly id = 'open-data' as const;
  readonly label = 'Open Data';
  readonly requiresKey = false;
  readonly supportsBuildingsInMesh = false;
  // Das Plugin empfiehlt errorTarget 1; Preset „Mittel“ (20 px) ergibt damit genau 1.
  protected override errorTargetScale = 1 / 20;

  private terrain: TerrariumMeshPlugin | null = null;
  private imagery: ImagerySource = IMAGERY_SOURCES[0]!;

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    super();
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  override async attach(...args: Parameters<TilesProviderBase['attach']>): Promise<void> {
    this.imagery = await pickImagery(this.fetchImpl);
    return super.attach(...args);
  }

  protected createTilesets(_settings: Settings, _renderer: WebGLRenderer): TilesRenderer[] {
    const overlay = new XYZTilesOverlay({ url: this.imagery.url, levels: this.imagery.levels });
    this.terrain = new TerrariumMeshPlugin({
      url: TERRARIUM_URL,
      maxZoom: 15,
      overlay,
      applyOverlayTexture: true,
    });
    const tiles = new TilesRenderer();
    tiles.registerPlugin(this.terrain);
    tiles.registerPlugin(new TilesFadePlugin());
    return [tiles];
  }

  override detach(): void {
    super.detach();
    this.terrain = null;
  }

  override sampleHeight(lat: number, lon: number): number | null {
    return (
      this.terrain?.sampleCartographicElevation((lat * Math.PI) / 180, (lon * Math.PI) / 180) ??
      null
    );
  }

  attributions(): AttributionEntry[] {
    return [this.imagery.attribution, TERRAIN_ATTRIBUTION];
  }
}
