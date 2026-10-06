import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { isTyping } from '../camera/input';
import type { CameraPose } from '../camera/flyTo';
import { geodeticToEcef } from '../core/geo';
import { readJson, writeJson } from '../core/storage';
import { pushToast, store } from '../core/store';
import type { GeoPoint } from '../core/types';
import { t } from '../ui/i18n';
import type { CountryIndex } from './countries';
import { pickEllipsoid } from './gameLayer';
import { REALM_COLORS } from './politicalMap';
import { destination, GAME_HOURS_PER_SECOND, UnitStore, type Unit, type UnitType } from './units';

/** Modus der Truppensteuerung: aus, Befehlen (Rahmen ziehen, Klick bewegt) oder Platzieren. */
export type ArmyMode = 'off' | 'command' | 'place';

export interface ArmyState {
  mode: ArmyMode;
  placeType: UnitType;
}

/** Auswahl für die UI. */
export interface ArmySelection {
  ids: number[];
  byType: Record<UnitType, number>;
  /** Gemeinsames Land der Auswahl (`null` = keinem Land). */
  owner: string | null;
  /** Die Auswahl gehört verschiedenen Ländern. */
  mixed: boolean;
  moving: number;
}

export interface ArmyDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  globe: Object3D;
  /** Globusmodus, kein Werkzeug, keine filmische Sequenz. */
  canInteract: () => boolean;
  getPose: () => CameraPose;
  setPose: (pose: CameraPose) => void;
  countries: () => CountryIndex | null;
}

/** Bildschirmgröße der Einheiten-Symbole (CSS-Pixel); überlappende Symbole werden gestapelt. */
const MARKER_W = 44;
const MARKER_H = 30;
const CLICK_SLOP_PX = 5;
const STORAGE_KEY = 'army';

const _v = new Vector3();
const _n = new Vector3();
const _c = new Vector3();
const _center = new Vector3();
const _toCam = new Vector3();
const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _pick: GeoPoint = { lat: 0, lon: 0, height: 0 };

interface Screen {
  unit: Unit;
  x: number;
  y: number;
}

/** Ein gezeichnetes Symbol: eine Einheit oder ein Stapel überlappender Einheiten eines Landes. */
interface Stack {
  units: Unit[];
  x: number;
  y: number;
}

/** NATO-Taktikzeichen (vereinfacht) als SVG-Inhalt in einem 28 × 20-Rahmen. */
const SYMBOL: Record<UnitType, string> = {
  infantry: '<path d="M2 2L26 18M26 2L2 18"/>',
  tank: '<rect x="6" y="6" width="16" height="8" rx="4"/>',
  air: '<path d="M14 10c-3-5-8-5-8 0s5 5 8 0c3 5 8 5 8 0s-5-5-8 0z"/>',
};

const ownerColor = (index: CountryIndex | null, owner: string | null): string => {
  const c = owner ? index?.byId.get(owner) : null;
  if (!c) return '#8a8f99';
  const col = REALM_COLORS[(c.colorClass - 1 + REALM_COLORS.length) % REALM_COLORS.length]!;
  return `#${col.getHexString()}`;
};

const fmt = (n: number): string => Math.round(n).toLocaleString(t.locale);

/**
 * Truppen der Spielschicht (S2): Einheiten platzieren und einem Land zuweisen, wie in Age of
 * Empires mit einem Rahmen auswählen und per Linksklick marschieren lassen. Die Symbole bleiben
 * aus jeder Höhe gleich groß (wie in Crusader Kings) und stapeln sich, wenn sie sich überlappen.
 */
export class Army {
  readonly store: UnitStore;
  readonly layer: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly rect: SVGRectElement;
  private readonly lines: SVGGElement;
  private readonly markers: HTMLDivElement[] = [];
  private stacks: Stack[] = [];
  private selected = new Set<number>();
  private drag: { x0: number; y0: number; x1: number; y1: number; add: boolean } | null = null;
  private placeDown: { x: number; y: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly disposers: (() => void)[] = [];
  private saveTimer = 0;
  private dirty = false;

  constructor(private readonly deps: ArmyDeps) {
    this.store = new UnitStore((lat, lon) => this.isLand(lat, lon));
    this.store.load(readJson(STORAGE_KEY, null));
    this.store.onChange = () => {
      this.dirty = true;
      this.publishSelection();
    };

    this.layer = document.createElement('div');
    this.layer.className = 'unit-layer';
    this.layer.dataset.testid = 'unit-layer';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('unit-overlay');
    this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.rect.classList.add('unit-select-rect');
    this.rect.style.display = 'none';
    this.svg.append(this.lines, this.rect);
    this.layer.append(this.svg);
    deps.canvas.after(this.layer);

    const on = <K extends keyof WindowEventMap>(
      target: Window,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      capture = false,
    ): void => {
      target.addEventListener(type, fn as EventListener, capture);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, capture));
    };
    // Vor allen anderen Zuhörern (Globus-Steuerung, Werkzeuge): im Befehlsmodus gehört die linke
    // Maustaste der Auswahl, rechts neigt/dreht weiter, das Mausrad zoomt
    on(window, 'pointerdown', (e) => this.onPointerDown(e), true);
    on(window, 'pointermove', (e) => this.onPointerMove(e));
    on(window, 'pointerup', (e) => this.onPointerUp(e));
    on(window, 'keydown', (e) => this.onKey(e, true));
    on(window, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => this.keys.clear());
    this.disposers.push(
      store.armyAction.subscribe((a) => {
        if (!a) return;
        if (a.kind === 'assign') this.assignSelected(a.owner);
        else if (a.kind === 'delete') this.deleteSelected();
        else if (a.kind === 'stop') this.stopSelected();
        else if (a.kind === 'clear') this.clearSelection();
      }),
    );
    this.publishSelection();
  }

  private get state(): ArmyState {
    return store.army.value;
  }

  private isLand(lat: number, lon: number): boolean {
    const index = this.deps.countries();
    // Ohne Länderdaten (noch nicht geladen) nichts verbieten
    if (!index) return true;
    // SIMPLIFIED: Land = Fläche eines Landes (Antarktis eingeschlossen); Seen zählen als Land
    return index.countryAt(lat, lon) !== null;
  }

  private active(): boolean {
    return this.state.mode !== 'off' && this.deps.canInteract();
  }

  // ---------------------------------------------------------------- Eingabe

  private onPointerDown(e: PointerEvent): void {
    if (e.target !== this.deps.canvas || e.button !== 0 || !this.active()) return;
    if (this.state.mode === 'place') {
      this.placeDown = { x: e.clientX, y: e.clientY };
      return;
    }
    // Befehlsmodus: Globus-Steuerung bekommt die linke Taste nicht (sonst dreht sich die Erde)
    e.stopImmediatePropagation();
    e.preventDefault();
    this.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey };
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    d.x1 = e.clientX;
    d.y1 = e.clientY;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) <= CLICK_SLOP_PX) return;
    const r = this.deps.canvas.getBoundingClientRect();
    this.rect.style.display = '';
    this.rect.setAttribute('x', String(Math.min(d.x0, d.x1) - r.left));
    this.rect.setAttribute('y', String(Math.min(d.y0, d.y1) - r.top));
    this.rect.setAttribute('width', String(Math.abs(d.x1 - d.x0)));
    this.rect.setAttribute('height', String(Math.abs(d.y1 - d.y0)));
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.placeDown) {
      const p = this.placeDown;
      this.placeDown = null;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP_PX && this.active()) {
        this.placeAt(e.clientX, e.clientY);
      }
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.rect.style.display = 'none';
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > CLICK_SLOP_PX) {
      this.selectInRect(d.x0, d.y0, d.x1, d.y1, d.add);
      return;
    }
    // Klick: Symbol getroffen → auswählen, sonst Marschbefehl an die Auswahl
    const stack = this.stackAt(e.clientX, e.clientY);
    if (stack) {
      if (!d.add) this.selected.clear();
      for (const u of stack.units) this.selected.add(u.id);
      this.publishSelection();
      return;
    }
    if (this.selected.size > 0) this.moveSelectedTo(e.clientX, e.clientY);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!down) {
      this.keys.delete(e.code);
      return;
    }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyU' && !e.repeat) {
      store.army.value = {
        ...this.state,
        mode: this.state.mode === 'command' ? 'off' : 'command',
      };
      return;
    }
    if (this.state.mode === 'off') return;
    if (e.code === 'Escape') {
      if (this.selected.size > 0) this.clearSelection();
      else store.army.value = { ...this.state, mode: 'off' };
      return;
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected.size > 0) {
      this.deleteSelected();
      return;
    }
    if (PAN_KEYS.has(e.code)) this.keys.add(e.code);
  }

  // ---------------------------------------------------------------- Befehle

  private geoAtClient(clientX: number, clientY: number): GeoPoint | null {
    const r = this.deps.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
    return pickEllipsoid(this.raycaster.ray, this.deps.globe, _pick);
  }

  private placeAt(clientX: number, clientY: number): void {
    const geo = this.geoAtClient(clientX, clientY);
    if (!geo) return;
    // Im Land platziert: gehört dem Land; auf dem Meer (Luftwaffe): dem gewählten Land
    const here = this.deps.countries()?.countryAt(geo.lat, geo.lon)?.id ?? null;
    const owner = here ?? store.selectedCountry.value?.id ?? null;
    const res = this.store.place(this.state.placeType, geo.lat, geo.lon, owner);
    if (!res.ok) {
      pushToast('info', t.army.notOnSea, 3000);
      return;
    }
    this.selected = new Set([res.unit.id]);
    this.publishSelection();
  }

  private moveSelectedTo(clientX: number, clientY: number): void {
    const geo = this.geoAtClient(clientX, clientY);
    if (!geo) return;
    const pose = this.deps.getPose();
    const spacingKm = Math.min(60, Math.max(1.5, (pose.height / 1000) * 0.02));
    const res = this.store.move([...this.selected], { lat: geo.lat, lon: geo.lon }, spacingKm);
    if (res.refusedSea > 0) pushToast('info', t.army.notOnSea, 3000);
  }

  private assignSelected(owner: string | null): void {
    if (this.selected.size === 0) return;
    this.store.assign(this.selected, owner);
  }

  private deleteSelected(): void {
    this.store.remove(this.selected);
    this.selected.clear();
    this.publishSelection();
  }

  private stopSelected(): void {
    for (const id of this.selected) {
      const u = this.store.get(id);
      if (u) u.target = null;
    }
    this.dirty = true;
    this.publishSelection();
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.publishSelection();
  }

  /** Alle Einheiten entfernen („Welt zurücksetzen“). */
  reset(): void {
    this.selected.clear();
    this.store.clear();
  }

  private selectInRect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const r = this.deps.canvas.getBoundingClientRect();
    const xa = Math.min(x0, x1) - r.left;
    const xb = Math.max(x0, x1) - r.left;
    const ya = Math.min(y0, y1) - r.top;
    const yb = Math.max(y0, y1) - r.top;
    if (!add) this.selected.clear();
    for (const s of this.stacks) {
      if (s.x >= xa && s.x <= xb && s.y >= ya && s.y <= yb) {
        for (const u of s.units) this.selected.add(u.id);
      }
    }
    this.publishSelection();
  }

  private stackAt(clientX: number, clientY: number): Stack | null {
    const r = this.deps.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    let best: Stack | null = null;
    let bestD = Infinity;
    for (const s of this.stacks) {
      const dx = Math.abs(x - s.x);
      const dy = Math.abs(y - s.y);
      if (dx > MARKER_W / 2 + 2 || dy > MARKER_H / 2 + 2) continue;
      const d = dx + dy;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private publishSelection(): void {
    // Gelöschte Einheiten aus der Auswahl nehmen
    for (const id of this.selected) if (!this.store.get(id)) this.selected.delete(id);
    const byType: Record<UnitType, number> = { infantry: 0, tank: 0, air: 0 };
    let owner: string | null | undefined;
    let mixed = false;
    let moving = 0;
    for (const id of this.selected) {
      const u = this.store.get(id)!;
      byType[u.type]++;
      if (u.target) moving++;
      if (owner !== undefined && owner !== u.owner) mixed = true;
      owner = u.owner;
    }
    store.armySelection.value = {
      ids: [...this.selected],
      byType,
      owner: mixed ? null : (owner ?? null),
      mixed,
      moving,
    };
    store.unitCount.value = this.store.size;
  }

  // ---------------------------------------------------------------- Je Frame

  update(dt: number, scaledDt: number): void {
    // Bewegung in Spielzeit (Pause und Zeitlupe gelten auch hier)
    if (scaledDt > 0 && this.store.step(scaledDt * GAME_HOURS_PER_SECOND)) this.dirty = true;
    this.panWithKeys(dt);
    this.render();
    this.saveTimer += dt;
    if (this.dirty && this.saveTimer >= 2) {
      this.saveTimer = 0;
      this.dirty = false;
      writeJson(STORAGE_KEY, this.store.toJSON());
      // Marschierende Einheiten: Anzeige „unterwegs“ aktuell halten
      this.publishSelection();
    }
  }

  /** WASD/Pfeiltasten verschieben die Kamera, solange die Truppensteuerung aktiv ist. */
  private panWithKeys(dt: number): void {
    if (this.keys.size === 0 || !this.active()) return;
    const k = (a: string, b: string): number => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
    const fwd = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    const side = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    if (!fwd && !side) return;
    const pose = this.deps.getPose();
    const km = (Math.max(1_000, pose.height) / 1000) * 0.9 * dt;
    const bearing = pose.heading + (Math.atan2(side, fwd) * 180) / Math.PI;
    const next = destination(pose.lat, pose.lon, bearing, km * Math.hypot(fwd, side));
    this.deps.setPose({ ...pose, lat: Math.max(-89, Math.min(89, next.lat)), lon: next.lon });
  }

  private render(): void {
    const units = this.store.units;
    const cam = this.deps.camera;
    const globe = this.deps.globe;
    const r = this.deps.canvas.getBoundingClientRect();
    const camPos = cam.getWorldPosition(_c);
    const center = globe.getWorldPosition(_center);
    const screen: Screen[] = [];
    for (const u of units) {
      const p = this.project(u.lat, u.lon, camPos, center, r);
      if (p) screen.push({ unit: u, x: p.x, y: p.y });
    }
    // Stapeln: überlappende Symbole desselben Landes zusammenfassen (große Verbände von weitem)
    const stacks: Stack[] = [];
    for (const s of screen) {
      const hit = stacks.find(
        (k) =>
          k.units[0]!.owner === s.unit.owner &&
          Math.abs(k.x - s.x) < MARKER_W * 0.8 &&
          Math.abs(k.y - s.y) < MARKER_H * 0.8,
      );
      if (hit) hit.units.push(s.unit);
      else stacks.push({ units: [s.unit], x: s.x, y: s.y });
    }
    this.stacks = stacks;
    const index = this.deps.countries();
    while (this.markers.length < stacks.length) {
      const m = document.createElement('div');
      m.className = 'unit-marker';
      m.innerHTML =
        '<span class="unit-flag"></span><svg viewBox="0 0 28 20" width="28" height="20" aria-hidden="true"></svg><span class="unit-count"></span>';
      this.layer.append(m);
      this.markers.push(m);
    }
    this.markers.forEach((m, i) => {
      const s = stacks[i];
      if (!s) {
        if (m.style.display !== 'none') m.style.display = 'none';
        return;
      }
      if (m.style.display === 'none') m.style.display = '';
      m.style.transform = `translate(${s.x - MARKER_W / 2}px, ${s.y - MARKER_H / 2}px)`;
      const main = dominantType(s.units);
      const selected = s.units.some((u) => this.selected.has(u.id));
      const strength = s.units.reduce((a, u) => a + u.strength, 0);
      const key = `${main}|${s.units[0]!.owner}|${s.units.length}|${selected}|${strength}`;
      if (m.dataset.key === key) return;
      m.dataset.key = key;
      m.dataset.type = main;
      m.classList.toggle('selected', selected);
      (m.firstElementChild as HTMLElement).style.background = ownerColor(index, s.units[0]!.owner);
      m.querySelector('svg')!.innerHTML = SYMBOL[main];
      const label = s.units.length > 1 ? `${s.units.length}×` : fmt(strength);
      (m.lastElementChild as HTMLElement).textContent = label;
      m.title = `${t.army.types[main]} · ${s.units[0]!.owner ?? t.army.noOwner} · ${fmt(strength)}`;
    });
    this.renderOrders(camPos, center, r);
  }

  /** Marschlinien der ausgewählten Einheiten. */
  private renderOrders(camPos: Vector3, center: Vector3, r: DOMRect): void {
    const parts: string[] = [];
    for (const id of this.selected) {
      const u = this.store.get(id);
      if (!u?.target) continue;
      const a = this.project(u.lat, u.lon, camPos, center, r);
      const b = this.project(u.target.lat, u.target.lon, camPos, center, r);
      if (!a || !b) continue;
      parts.push(
        `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`,
        `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="4"/>`,
      );
    }
    const html = parts.join('');
    if (this.lines.dataset.html !== html) {
      this.lines.dataset.html = html;
      this.lines.innerHTML = html;
    }
  }

  /** Bildschirmpunkt (CSS-Pixel relativ zum Canvas) oder null hinter dem Erdrand/außerhalb. */
  private project(
    lat: number,
    lon: number,
    camPos: Vector3,
    center: Vector3,
    r: DOMRect,
  ): { x: number; y: number } | null {
    _geo.lat = lat;
    _geo.lon = lon;
    _geo.height = 0;
    geodeticToEcef(_geo, _v);
    _v.applyMatrix4(this.deps.globe.matrixWorld);
    _n.subVectors(_v, center).normalize();
    _toCam.subVectors(camPos, _v);
    if (_n.dot(_toCam.normalize()) < 0) return null;
    _v.project(this.deps.camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) return null;
    return { x: ((_v.x + 1) / 2) * r.width, y: ((1 - _v.y) / 2) * r.height };
  }

  dispose(): void {
    for (const d of this.disposers) d();
    writeJson(STORAGE_KEY, this.store.toJSON());
    this.layer.remove();
  }
}

const PAN_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function dominantType(units: readonly Unit[]): UnitType {
  const n: Record<UnitType, number> = { infantry: 0, tank: 0, air: 0 };
  for (const u of units) n[u.type]++;
  return n.tank >= n.infantry && n.tank >= n.air
    ? 'tank'
    : n.infantry >= n.air
      ? 'infantry'
      : 'air';
}
