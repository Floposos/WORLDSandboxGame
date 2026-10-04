import { Ray, Vector3 } from 'three';
import type { FloatingOrigin } from '../core/floatingOrigin';
import type { GeoPoint } from '../core/types';
import type { HeightSampler } from './heightSampler';
import type { TileProvider } from './providers/TileProvider';

/** Siehe ADR-015: größere Abweichung nach unten heißt „Mesh noch grob“. */
export const COARSE_MESH_TOLERANCE_M = 150;

export interface GroundHit {
  /** Bodenpunkt in Weltkoordinaten. */
  point: Vector3;
  /** Höhe des Bodens über dem Ellipsoid in m. */
  height: number;
  /** Flächennormale (Welt), oder die lokale Aufrichtung, falls unbekannt. */
  normal: Vector3;
  /** Woher die Höhe stammt. */
  source: 'mesh' | 'provider' | 'sampler';
}

/** Höher als das über dem gemessenen Gelände kann kein Gebäude sein (Burj Khalifa: 828 m). */
export const MAX_BUILDING_HEIGHT_M = 1_000;

/**
 * Wählt die Bodenhöhe aus Mesh-Treffer und gemessener Höhe (ADR-015):
 * - Meshes ohne Gebäude (Open Data) sind mit genau diesen Höhen verschoben; die gemessene Höhe
 *   ist exakt, das Mesh je nach Detailstufe grob (auch weit darüber oder darunter).
 * - Mit Gebäuden (Google/Cesium) gilt das Mesh, außer es liegt mehr als
 *   {@link COARSE_MESH_TOLERANCE_M} darunter (grobe Kachel) oder mehr als
 *   {@link MAX_BUILDING_HEIGHT_M} darüber (Unsinn).
 */
export function chooseGroundHeight(
  meshHeight: number | null,
  sampledHeight: number | null,
  meshHasBuildings = true,
): { height: number; fromMesh: boolean } | null {
  if (meshHeight === null)
    return sampledHeight === null ? null : { height: sampledHeight, fromMesh: false };
  if (sampledHeight === null) return { height: meshHeight, fromMesh: true };
  if (
    !meshHasBuildings ||
    sampledHeight - meshHeight > COARSE_MESH_TOLERANCE_M ||
    meshHeight - sampledHeight > MAX_BUILDING_HEIGHT_M
  ) {
    return { height: sampledHeight, fromMesh: false };
  }
  return { height: meshHeight, fromMesh: true };
}

const _ray = new Ray();
const _up = new Vector3();
const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };

/**
 * „Boden unter Punkt“ für Kameras, Vorschau und später Werkzeuge.
 * Reihenfolge: Raycast auf das gerenderte Mesh (bei Google/Cesium inkl. Gebäude), sonst bzw.
 * bei grobem Mesh die Höhe des Providers (Terrarium-Daten des Plugins), sonst der eigene
 * {@link HeightSampler}.
 */
export class GroundService {
  constructor(
    private readonly origin: FloatingOrigin,
    private readonly getProvider: () => TileProvider | null,
    private readonly sampler: HeightSampler,
  ) {}

  /** Gemessene Geländehöhe (ohne Gebäude) in m, oder null, solange keine Daten da sind. */
  heightAt(lat: number, lon: number): number | null {
    return this.getProvider()?.sampleHeight(lat, lon) ?? this.sampler.sample(lat, lon);
  }

  /**
   * Boden unter `pos`. Der Strahl startet `fromAboveM` über `pos` (Treppenstufen, Dächer:
   * klein wählen; „irgendwo darunter“: groß wählen).
   */
  below(pos: Vector3, fromAboveM = 2, useMesh = true): GroundHit | null {
    const geo = this.origin.worldToGeo(pos, _geo);
    _up.copy(this.origin.basisAt(pos).up);
    const provider = this.getProvider();
    const fromProvider = provider?.sampleHeight(geo.lat, geo.lon) ?? null;
    const sampled = fromProvider ?? this.sampler.sample(geo.lat, geo.lon);

    // Das Open-Data-Mesh ist mit genau den Provider-Höhen verschoben; dort spart das den teuren
    // Raycast (das Terrarium-Plugin verschiebt die Vertices dafür jedes Mal auf der CPU neu).
    const wantMesh =
      useMesh && provider && (provider.supportsBuildingsInMesh || fromProvider === null);
    let meshHit: ReturnType<TileProvider['raycast']> = null;
    if (wantMesh) {
      _ray.origin.copy(pos).addScaledVector(_up, fromAboveM);
      _ray.direction.copy(_up).negate();
      meshHit = provider.raycast(_ray);
    }
    const choice = chooseGroundHeight(
      meshHit ? meshHit.geo.height : null,
      sampled,
      provider?.supportsBuildingsInMesh ?? true,
    );
    if (!choice) return null;
    if (choice.fromMesh && meshHit) {
      return {
        point: meshHit.point,
        height: choice.height,
        normal: meshHit.normal ?? _up.clone(),
        source: 'mesh',
      };
    }
    // Punkt senkrecht unter pos auf der gemessenen Höhe
    const point = this.origin.geoToWorld({ lat: geo.lat, lon: geo.lon, height: choice.height });
    return {
      point,
      height: choice.height,
      normal: _up.clone(),
      source: fromProvider !== null ? 'provider' : 'sampler',
    };
  }

  /** Höhe von `pos` über dem Boden darunter (oder null). */
  heightAbove(pos: Vector3, fromAboveM = 2, useMesh = true): number | null {
    const hit = this.below(pos, fromAboveM, useMesh);
    if (!hit) return null;
    return this.origin.worldToGeo(pos, _geo).height - hit.height;
  }
}
