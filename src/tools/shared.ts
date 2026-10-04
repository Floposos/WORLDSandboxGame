import { Vector3 } from 'three';
import { MATERIALS, type MaterialId } from '../physics/world';
import { t } from '../ui/i18n';
import type { ToolParam } from './Tool';

/** Auswahl-Parameter „Material“ für Bau-Werkzeuge. */
export function materialParam(
  label: string,
  def: MaterialId,
  ids: MaterialId[] = ['wood', 'concrete', 'metal'],
): ToolParam {
  return {
    key: 'material',
    label,
    type: 'select',
    options: ids.map((value) => ({ value, label: t.tools.materials[value] })),
    default: def,
  };
}

export function asMaterial(v: unknown): MaterialId {
  return typeof v === 'string' && v in MATERIALS ? (v as MaterialId) : 'wood';
}

/** Gierwinkel (um y), der vom Punkt zur Kamera blickt – Objekte stehen „zum Spieler“. */
export function yawTowards(from: Vector3, to: Vector3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Rasterpositionen eines Stapels: n Objekte der Kantenlänge s, quadratischer Grundriss. */
export function stackOffsets(n: number, s: number, gap = 0.04): Vector3[] {
  const side = Math.max(1, Math.ceil(Math.sqrt(Math.min(n, 25))));
  const perLayer = side * side;
  const pitch = s * (1 + gap);
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / perLayer);
    const k = i % perLayer;
    const r = Math.floor(k / side);
    const c = k % side;
    out.push(
      new Vector3(
        (c - (side - 1) / 2) * pitch,
        layer * pitch + s / 2,
        (r - (side - 1) / 2) * pitch,
      ),
    );
  }
  return out;
}
