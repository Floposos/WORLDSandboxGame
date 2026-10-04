import { haversineDistance, interpolateGreatCircle } from '../core/geo';
import type { GeoPoint } from '../core/types';

/** Kamerapose in geografischen Größen. Winkel in Grad. */
export interface CameraPose extends GeoPoint {
  /** Kurs, 0 = Nord, im Uhrzeigersinn */
  heading: number;
  /** Neigung, 0 = Horizont, −90 = senkrecht nach unten */
  pitch: number;
}

export interface FlightPlan {
  from: CameraPose;
  to: CameraPose;
  distanceM: number;
  durationS: number;
  /** Zusätzliche Scheitelhöhe über der höheren der beiden Endhöhen. */
  arcM: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Weiches Ein- und Ausschwingen (smootherstep). */
export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Dauer in Sekunden: kurz für Nachbarorte, länger für Flüge um die halbe Welt. */
export function flightDuration(distanceM: number): number {
  return clamp(1.5 + 1.3 * Math.log10(1 + distanceM / 1000), 1.5, 8);
}

/**
 * Plant einen gekrümmten Flug: steigen, reisen, sinken (Spezifikation 6.1).
 * Die Scheitelhöhe wächst mit der Distanz, damit man unterwegs die Erde sieht.
 */
export function planFlight(from: CameraPose, to: CameraPose): FlightPlan {
  const distanceM = haversineDistance(from, to);
  const peak = clamp(distanceM * 0.5, 0, 12_000_000);
  const arcM = Math.max(0, peak - Math.max(from.height, to.height));
  return { from, to, distanceM, durationS: flightDuration(distanceM), arcM };
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** Pose zum normierten Zeitpunkt t ∈ [0, 1]. */
export function flightPose(plan: FlightPlan, t: number): CameraPose {
  const { from, to, arcM } = plan;
  const e = easeInOut(t);
  const pos = interpolateGreatCircle(from, to, e);
  const height = from.height + (to.height - from.height) * e + arcM * Math.sin(Math.PI * e);
  // Unterwegs senkrecht nach unten schauen, am Ende auf die Zielneigung schwenken.
  const lookDown = -89;
  const pitch =
    arcM > 0
      ? e < 0.5
        ? from.pitch + (lookDown - from.pitch) * easeInOut(e * 2)
        : lookDown + (to.pitch - lookDown) * easeInOut((e - 0.5) * 2)
      : from.pitch + (to.pitch - from.pitch) * e;
  return {
    lat: pos.lat,
    lon: pos.lon,
    height,
    heading: (lerpAngle(from.heading, to.heading, e) + 360) % 360,
    pitch,
  };
}

/**
 * Sinnvolle Betrachtungshöhe über Grund für ein Suchergebnis: aus der Ausdehnung
 * (Bounding Box) oder einem Standardwert für Punkte.
 */
export function viewDistanceFor(extent?: [number, number, number, number]): number {
  if (!extent) return 4_000;
  const [minLon, minLat, maxLon, maxLat] = extent;
  const diag = haversineDistance(
    { lat: minLat, lon: minLon, height: 0 },
    { lat: maxLat, lon: maxLon, height: 0 },
  );
  return clamp(diag * 1.4, 1_500, 4_000_000);
}
