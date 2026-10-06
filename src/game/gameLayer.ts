import { Matrix4, Ray, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { WGS84 } from '../core/constants';
import { ecefToGeodetic, geodeticToEcef } from '../core/geo';
import { isTyping } from '../camera/input';
import type { GeoPoint } from '../core/types';
import { store, updateSettings } from '../core/store';
import { syncAttributions } from '../ui/attributions';
import { t } from '../ui/i18n';
import { loadCountries, type Country, type CountryIndex } from './countries';
import { PoliticalMap } from './politicalMap';

const _inv = new Matrix4();
const _ray = new Ray();

/**
 * Schnittpunkt eines Strahls (Welt) mit dem WGS84-Ellipsoid → geodätisch, oder null.
 * Für die Länderwahl genügt das Ellipsoid (Gelände ändert den Punkt um höchstens Meter).
 */
export function pickEllipsoid(ray: Ray, globe: Object3D, out: GeoPoint): GeoPoint | null {
  _inv.copy(globe.matrixWorld).invert();
  _ray.copy(ray).applyMatrix4(_inv);
  // Ellipsoid → Einheitskugel: z mit a/b strecken, alles durch a teilen
  const k = WGS84.a / WGS84.b;
  const ox = _ray.origin.x / WGS84.a;
  const oy = _ray.origin.y / WGS84.a;
  const oz = (_ray.origin.z * k) / WGS84.a;
  const dx = _ray.direction.x;
  const dy = _ray.direction.y;
  const dz = _ray.direction.z * k;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const p = {
    x: (ox + t * dx) * WGS84.a,
    y: (oy + t * dy) * WGS84.a,
    z: ((oz + t * dz) * WGS84.a) / k,
  };
  return ecefToGeodetic(p, out);
}

/** Was die UI über ein Land zeigt. */
export interface CountryInfo {
  id: string;
  name: string;
  iso2: string | null;
  population: number;
  areaKm2: number;
}

/** Beschriftung auf dem Bildschirm (CSS-Pixel). */
export interface CountryLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
}

export interface GameLayerDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  globe: Object3D;
  /** Kamera im Globusmodus und kein Werkzeug aktiv: Klicks gehören der Karte. */
  canPick: () => boolean;
  lang: 'de' | 'en';
}

/** Mausweg in Pixeln, ab dem ein Klick als Ziehen gilt. */
const CLICK_SLOP_PX = 5;
/** Höchstens so viele Länderbeschriftungen gleichzeitig. */
const MAX_LABELS = 70;

const _v = new Vector3();
const _n = new Vector3();
const _c = new Vector3();
const _center = new Vector3();
const _toCam = new Vector3();
const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _labelGeo: GeoPoint = { lat: 0, lon: 0, height: 0 };

/**
 * Spielschicht (Etappe 1): lädt die Länder, zeichnet die politische Karte, wählt Länder per Klick
 * und berechnet die Beschriftungen. Taste G schaltet die Karte (Einstellung `politicalMap`).
 */
export class GameLayer {
  countries: CountryIndex | null = null;
  map: PoliticalMap | null = null;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private down: { x: number; y: number; button: number } | null = null;
  private hoverDirty = false;
  private labelTimer = 0;
  private hoverTimer = 0;
  private readonly disposers: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly deps: GameLayerDeps) {
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
    ): void => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(deps.canvas, 'pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    on(deps.canvas, 'pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.button !== 0 || !this.active || !deps.canPick()) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      const c = this.countryAtClient(e.clientX, e.clientY);
      this.selectCountry(c);
    });
    on(deps.canvas, 'pointermove', (e) => {
      this.setNdc(e.clientX, e.clientY);
      this.hoverDirty = true;
    });
    on(deps.canvas, 'pointerleave', () => {
      this.map?.hover(null);
      this.hoverDirty = false;
    });
    on(window, 'keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === 'KeyG') updateSettings({ politicalMap: !store.settings.value.politicalMap });
      else if (e.code === 'Escape' && store.selectedCountry.value && !store.activeToolId.value) {
        this.selectCountry(null);
      }
    });
    this.disposers.push(
      store.settings.subscribe((s) => {
        if (s.politicalMap) void this.ensureLoaded();
        if (this.map) this.map.visible = s.politicalMap;
        if (!s.politicalMap) store.countryLabels.value = [];
        this.syncAttribution();
      }),
    );
  }

  /** Karte sichtbar und geladen. */
  get active(): boolean {
    return !!this.map && store.settings.value.politicalMap;
  }

  private loading: Promise<void> | null = null;
  ensureLoaded(): Promise<void> {
    this.loading ??= loadCountries()
      .then((index) => {
        if (this.disposed) return;
        this.countries = index;
        this.map = new PoliticalMap(this.deps.globe, index);
        this.map.visible = store.settings.value.politicalMap;
        store.countriesReady.value = true;
        this.syncAttribution();
      })
      .catch((err: unknown) => {
        console.warn('[countries]', err);
        this.loading = null;
        store.countriesReady.value = false;
      });
    return this.loading;
  }

  /** Natural Earth ist gemeinfrei; die Quelle steht trotzdem in der Leiste (ADR-026). */
  private syncAttribution(): void {
    syncAttributions(
      'countries',
      this.map && store.settings.value.politicalMap
        ? [
            {
              id: 'natural-earth',
              text: t.game.attribution,
              url: 'https://www.naturalearthdata.com',
              license: 'Public Domain',
            },
          ]
        : [],
    );
  }

  private setNdc(clientX: number, clientY: number): void {
    const r = this.deps.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** Land unter einem Bildschirmpunkt. */
  countryAtClient(clientX: number, clientY: number): Country | null {
    this.setNdc(clientX, clientY);
    return this.countryAtNdc();
  }

  private countryAtNdc(): Country | null {
    if (!this.countries) return null;
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
    const geo = pickEllipsoid(this.raycaster.ray, this.deps.globe, _geo);
    return geo ? this.countries.countryAt(geo.lat, geo.lon) : null;
  }

  selectCountry(c: Country | null): void {
    this.map?.select(c);
    store.selectedCountry.value = c
      ? {
          id: c.id,
          name: c.name[this.deps.lang],
          iso2: c.iso2,
          population: c.population,
          areaKm2: c.areaKm2,
        }
      : null;
  }

  update(dt: number, cameraHeightM: number): void {
    const map = this.map;
    if (!map || !map.visible) return;
    map.update(this.deps.camera, cameraHeightM);
    this.hoverTimer += dt;
    if (this.hoverDirty && this.hoverTimer >= 0.1) {
      this.hoverTimer = 0;
      this.hoverDirty = false;
      map.hover(this.deps.canPick() ? this.countryAtNdc() : null);
    }
    this.labelTimer += dt;
    if (this.labelTimer >= 0.1) {
      this.labelTimer = 0;
      store.countryLabels.value = this.computeLabels(cameraHeightM);
    }
  }

  /**
   * Beschriftungen wie auf einer Strategiekarte: große Länder zuerst, Schriftgröße nach der
   * Bildschirmgröße des Landes, keine Überlappung, nur auf der sichtbaren Erdseite.
   */
  private computeLabels(cameraHeightM: number): CountryLabel[] {
    const index = this.countries;
    if (!index || cameraHeightM < 150_000) return [];
    const cam = this.deps.camera;
    const globe = this.deps.globe;
    const r = this.deps.canvas.getBoundingClientRect();
    const camPos = cam.getWorldPosition(_c);
    const center = globe.getWorldPosition(_center);
    const fovY = ((cam as { fov?: number }).fov ?? 60) * (Math.PI / 180);
    const pxPerRad = r.height / fovY;
    const candidates: { c: Country; x: number; y: number; px: number }[] = [];
    for (const c of index.countries) {
      _labelGeo.lat = c.label.lat;
      _labelGeo.lon = c.label.lon;
      geodeticToEcef(_labelGeo, _v);
      _v.applyMatrix4(globe.matrixWorld);
      // Horizont: Normale (vom Erdmittelpunkt) zeigt zur Kamera?
      _n.subVectors(_v, center).normalize();
      _toCam.subVectors(camPos, _v);
      const dist = _toCam.length();
      if (_n.dot(_toCam.divideScalar(dist)) < 0.05) continue;
      // Scheinbare Größe: Wurzel der Fläche durch Abstand
      const px = (Math.sqrt(c.areaKm2) * 1000 * pxPerRad) / dist;
      if (px < 28) continue;
      _v.project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) continue;
      candidates.push({
        c,
        x: ((_v.x + 1) / 2) * r.width,
        y: ((1 - _v.y) / 2) * r.height,
        px,
      });
    }
    candidates.sort((a, b) => b.px - a.px);
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: CountryLabel[] = [];
    for (const k of candidates) {
      if (out.length >= MAX_LABELS) break;
      const name = k.c.name[this.deps.lang];
      const size = Math.round(Math.min(26, Math.max(11, k.px / 9)));
      const w = name.length * size * 0.62 + 8;
      const h = size * 1.3;
      const box = { x0: k.x - w / 2, y0: k.y - h / 2, x1: k.x + w / 2, y1: k.y + h / 2 };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) {
        continue;
      }
      placed.push(box);
      out.push({ id: k.c.id, name, x: Math.round(k.x), y: Math.round(k.y), size });
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposers) d();
    this.map?.dispose();
    this.map = null;
  }
}
