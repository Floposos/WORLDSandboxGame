import type { Camera, Object3D, Ray, Scene, Vector3, WebGLRenderer } from 'three';
import type { Settings } from '../../core/settings';
import type { AttributionEntry, GeoPoint } from '../../core/types';

export type ProviderId = 'google' | 'cesium-ion' | 'open-data';

/** Ergebnis eines Raycasts auf die Welt. */
export interface WorldHit {
  /** Treffpunkt in Weltkoordinaten (three.js-Szene). */
  point: Vector3;
  /** Flächennormale in Weltkoordinaten, falls bekannt. */
  normal: Vector3 | null;
  geo: GeoPoint;
  distance: number;
}

export interface ProviderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  /**
   * Gruppe im ECEF-Frame des Globus (Erdmittelpunkt im Ursprung, Z = Nordpol).
   * Provider hängen ihre Tiles hier ein; die Gruppe selbst wird vom Floating Origin bewegt.
   */
  globe: Object3D;
}

/** Fehler, der zum Wechsel auf den nächsten Provider der Kette führt. */
export class ProviderError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly reason: 'no-key' | 'unauthorized' | 'quota' | 'network' | 'timeout' | 'other',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Gemeinsame Schnittstelle aller Welt-Quellen (Spezifikation 5.1).
 * Abweichung: `attach` bekommt einen {@link ProviderContext} statt drei Einzelargumenten,
 * damit Provider in die Globus-Gruppe statt direkt in die Szene einhängen (ADR-011).
 */
export interface TileProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly requiresKey: boolean;
  /** true bei Fotogrammetrie (Gebäude stecken im Mesh). */
  readonly supportsBuildingsInMesh: boolean;
  /** Schnelle Vorprüfung (Key vorhanden, ggf. Test-Request). */
  isAvailable(settings: Settings): Promise<boolean>;
  /**
   * Hängt den Provider ein und wartet, bis die Wurzel geladen ist. Wirft {@link ProviderError},
   * wenn die Quelle nicht nutzbar ist (z. B. ungültiger Key).
   */
  attach(ctx: ProviderContext, settings: Settings): Promise<void>;
  detach(): void;
  /** Pro Frame aufrufen. */
  update(): void;
  raycast(ray: Ray): WorldHit | null;
  /** Geländehöhe über dem Ellipsoid in Metern aus geladenen Daten, sonst null. */
  sampleHeight(lat: number, lon: number): number | null;
  attributions(): AttributionEntry[];
  /** Laufzeitfehler (z. B. Quota) melden, damit die Kette wechseln kann. */
  onFailure(handler: (error: ProviderError) => void): void;
  /** Fehlertoleranz (Pixel) aus dem Grafik-Preset. */
  setErrorTarget(px: number): void;
}
