import {
  Color,
  Raycaster,
  Vector2,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Ray,
  type Scene,
} from 'three';
import { AudioEngine } from '../audio/audio';
import type { CameraRig } from '../camera/cameraRig';
import type { GlobeCamera } from '../camera/globeCamera';
import type { CameraInput } from '../camera/input';
import { isTyping } from '../camera/input';
import type { EventBus, GameEvents } from '../core/events';
import type { FloatingOrigin } from '../core/floatingOrigin';
import type { Rng } from '../core/random';
import { presetOf } from '../core/settings';
import { pushToast, setToolParam, store } from '../core/store';
import type { GeoPoint } from '../core/types';
import { refineCoarseHit } from './coarseHit';
import { Destruction, type BuildingStatus } from '../physics/destruction';
import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type PhysicsHit } from '../physics/world';
import { t } from '../ui/i18n';
import { Effects } from '../vfx/effects';
import type { BuildingCell, BuildingService } from '../world/buildings/buildingService';
import type { BuildingRange } from '../world/buildings/extrude';
import type { Footprint } from '../world/buildings/overpass';
import type { CraterService } from '../world/craters';
import type { HeightSampler } from '../world/heightSampler';
import type { TileMask } from '../world/tileMask';
import { FloodWater } from '../world/water/water';
import { GlobeEffects } from '../world/globeFx/globeEffects';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer/three';
import { Driving } from './driving';
import {
  ExplosionService,
  explosionSummary,
  type DetonateOptions,
  type Detonator,
  type ExplosionResult,
} from './explosions';
import { createDefaultRegistry } from './index';
import {
  clampParam,
  defaultParams,
  type ParamValues,
  type GlobeTarget,
  type GlobeToolContext,
  type Tool,
  type ToolContext,
  type ToolEnv,
  type WorldApi,
  type WorldHit,
} from './Tool';

/** Werkzeuge wirken nur, wenn die Kamera tiefer als das über dem Boden ist. */
export const TOOL_MAX_CAMERA_AGL_M = 5_000;
/** Ab dieser Kamerahöhe zielen Werkzeuge mit `targetMode: 'both'` auf den Globus (Effekt-Hülle sichtbar). */
export const BOTH_GLOBE_AGL_M = 30_000;
/** Ein Klick ist ein Drücken/Loslassen mit höchstens so viel Bewegung (Pixel). */
const CLICK_SLOP_PX = 6;

export interface ToolManagerDeps {
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: PerspectiveCamera;
  globe: Object3D;
  origin: FloatingOrigin;
  rig: CameraRig;
  input: CameraInput;
  events: EventBus<GameEvents>;
  rng: Rng;
  sampler: HeightSampler;
  buildings: BuildingService;
  /** Treffer auf Tiles/Gelände bzw. sichtbare Gebäude (Welt). */
  raycastWorld: (ray: Ray) => { point: Vector3; distance: number } | null;
  /** Kamerahöhe über Grund in m. */
  cameraAgl: () => number;
  /** Maske für das Tile-Mesh (Krater, zerstörte Gebäude im Fotogrammetrie-Modus). */
  mask: TileMask;
  craters: CraterService;
  /** Stecken Gebäude im Tile-Mesh (Google/Cesium)? Dann zerstörte Gebäude maskieren. */
  buildingsInMesh: () => boolean;
  globeCamera: GlobeCamera;
}

/** Brenndauer eines getroffenen Gebäudes in s. */
const BUILDING_FIRE_S = 45;

const _ndc = new Vector2();
const _hitGeo: GeoPoint = { lat: 0, lon: 0, height: 0 };
const _ray = new Raycaster();

/**
 * Verbindet Werkzeuge mit Eingabe, Physik und UI: Auswahl über `store.activeToolId`, Klick ins
 * Bild → Raycast → Simulationsblase sicherstellen → `tool.onPointerDown`. Lädt Rapier beim ersten
 * Werkzeug, das Physik braucht (Spec M3 „Lazy Load“).
 */
export class ToolManager {
  readonly registry = createDefaultRegistry();
  readonly driving: Driving;
  private physicsValue: PhysicsWorld | null = null;
  private physicsLoading: Promise<PhysicsWorld | null> | null = null;
  private active: Tool | null = null;
  private down: { x: number; y: number; locked: boolean; button: number } | null = null;
  private busy = false;
  private readonly disposers: (() => void)[] = [];
  readonly effects = new Effects(presetOf(store.settings.value).maxParticles);
  readonly audio = new AudioEngine();
  private destructionValue: Destruction | null = null;
  private explosionsValue: ExplosionService | null = null;
  private readonly tasks: ((dt: number) => boolean)[] = [];
  /** Seit dem letzten Frame simulierte Zeit: Effekte laufen synchron zur Physik. */
  private simDt = 0;
  /** Masken zerstörter Gebäude (Gebäude-ID → Masken-ID). */
  private readonly buildingMasks = new Map<number, number>();
  private readonly camWorld = new Vector3();
  /** Wasserspiegel der Blase (Flut, Tsunami). */
  readonly water = new FloodWater();
  /** Effekte auf dem Globus (Stufe 5). */
  readonly globeFx: GlobeEffects;
  /** Licht und Himmel für Wasser (schreibt die Engine pro Frame). */
  readonly ambience = { sunDir: new Vector3(0, 1, 0), sky: new Color(0x8db4e2), light: 1 };
  /** Zuletzt gesehene Parameter des aktiven Werkzeugs (erkennt Änderungen). */
  private lastParams: ParamValues | undefined;
  private suppressParams = false;
  /** Für Werkzeuge: Explosion samt Bilanz-Toast (die Physik steht, wenn Werkzeuge laufen). */
  private readonly detonator: Detonator = {
    detonate: (pos, tnt, opts) => this.detonate(pos, tnt, opts)!,
  };

  constructor(private readonly deps: ToolManagerDeps) {
    this.driving = new Driving(deps.rig, () => this.physicsValue);
    this.globeFx = new GlobeEffects(deps.globe);
    this.effects.random = () => deps.rng.next();
    const applyAudio = (): void => {
      const s = store.settings.value;
      this.audio.setVolume(s.masterVolume, s.muted);
    };
    applyAudio();
    this.disposers.push(store.settings.subscribe(applyAudio));
    this.driving.onNoCar = () => pushToast('info', t.tools.driveNoCar, 3000);
    store.tools.value = this.registry.all().map((tool) => ({
      id: tool.id,
      name: tool.name,
      tier: tool.tier,
      icon: tool.icon,
      description: tool.description,
      params: tool.params,
    }));
    const params: Record<string, ParamValues> = {};
    for (const tool of this.registry.all()) params[tool.id] = defaultParams(tool);
    store.toolParams.value = params;

    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
    ): void => {
      target.addEventListener(type, fn as EventListener);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(deps.canvas, 'pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, locked: deps.input.locked, button: e.button };
    });
    on(deps.canvas, 'pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.button !== 0 || !this.active) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX && !d.locked) return;
      const mode = deps.rig.mode;
      // In Flug-/Bodenmodus zielt die Bildmitte; der erste Klick fängt nur die Maus
      if (mode === 'fly' || mode === 'ground') {
        if (!d.locked) return;
        _ndc.set(0, 0);
      } else if (mode === 'globe') {
        const r = deps.canvas.getBoundingClientRect();
        _ndc.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        );
      } else {
        return;
      }
      void this.use(_ndc.clone());
    });
    on(window, 'keydown', (e) => {
      // Esc im Hinweis-Dialog schließt nur den Hinweis, das Werkzeug bleibt gewählt
      if (
        e.code === 'Escape' &&
        !isTyping(e) &&
        store.activeToolId.value &&
        !store.apocalypseHint.value
      ) {
        // Esc gibt im Flug-/Bodenmodus zuerst die Maus frei (Browser); dann Werkzeug abwählen
        if (!deps.input.locked) store.activeToolId.value = null;
      }
    });
    const unsub = store.activeToolId.subscribe((id) => this.select(id));
    this.disposers.push(unsub);
    this.disposers.push(store.toolParams.subscribe(() => this.paramsChanged()));
    this.disposers.push(
      store.toolAction.subscribe((a) => {
        const tool = this.active;
        if (!a || !tool || tool.id !== a.toolId || !tool.onAction) return;
        if (store.toolBusy.value || store.apocalypseHint.value) return;
        void tool.onAction(a.key, this.params(tool), this.env(tool, a.key));
      }),
    );
  }

  /** Parameter des aktiven Werkzeugs geändert: sofort wirkende Werkzeuge anwenden. */
  private paramsChanged(): void {
    const tool = this.active;
    if (!tool) return;
    const raw = store.toolParams.value[tool.id];
    if (raw === this.lastParams) return;
    this.lastParams = raw;
    if (this.suppressParams || !tool.onParams) return;
    tool.onParams(this.params(tool), this.env(tool));
  }

  /** Umgebung für sofort wirkende Werkzeuge (auch ohne Physik). */
  private env(tool: Tool, actionKey?: string): ToolEnv {
    const d = this.deps;
    return {
      physics: this.physicsValue,
      events: d.events,
      water: this.water,
      focus: () => {
        const p = this.physicsValue;
        // Blasenmitte, solange die Kamera in der Nähe ist; sonst der Punkt unter der Kamera
        if (p?.frame && p.worldToBubble(d.camera.position).length() < 20_000) {
          return p.bubbleToGeo(new Vector3());
        }
        return d.origin.worldToGeo(d.camera.position);
      },
      setParams: (values) => {
        this.suppressParams = true;
        try {
          for (const [k, v] of Object.entries(values)) setToolParam(tool.id, k, v);
        } finally {
          this.suppressParams = false;
          this.lastParams = store.toolParams.value[tool.id];
        }
      },
      toast: (kind, text) => pushToast(kind, text, 6000),
      setBusy: (busy) => {
        store.toolBusy.value = busy ? `${tool.id}:${actionKey ?? ''}` : null;
      },
      world: this.world,
    };
  }

  /** Zugriff auf die ganze Welt (filmische Sequenzen, globale Werkzeuge). */
  get world(): WorldApi {
    return {
      globeFx: this.globeFx,
      globeCamera: this.deps.globeCamera,
      rig: this.deps.rig,
      origin: this.deps.origin,
      physics: this.physicsValue,
      destruction: this.destructionValue,
      audio: this.audio,
      resetWorld: () => this.resetWorld(),
    };
  }

  /**
   * „Welt zurücksetzen“ (Spec 8, global): Globus-Effekte und Sequenzen beenden, Krater entfernen,
   * alle Gebäude wieder aufstellen, Blase am selben Ort neu aufbauen (alle Körper weg), 1 g.
   */
  async resetWorld(): Promise<void> {
    const d = this.deps;
    this.globeFx.clear();
    d.globeCamera.setScript(null);
    store.cinematic.value = null;
    d.craters.clear();
    for (const id of this.buildingMasks.values()) d.mask.remove(id);
    this.buildingMasks.clear();
    this.destructionValue?.reset();
    for (const cell of d.buildings.loadedCells) {
      for (const range of cell.data.buildings) showBuilding(cell, range);
    }
    this.effects.clear();
    const physics = this.physicsValue;
    if (physics) {
      physics.setGravityScale(1);
      physics.restoreBuildings();
      await physics.resetBubble();
    }
    store.destroyedBuildings.value = 0;
  }

  get physics(): PhysicsWorld | null {
    return this.physicsValue;
  }

  /** Lädt Rapier und erzeugt die Physikwelt (einmalig). */
  ensurePhysics(): Promise<PhysicsWorld | null> {
    if (this.physicsValue) return Promise.resolve(this.physicsValue);
    this.physicsLoading ??= (async () => {
      store.physicsState.value = 'loading';
      try {
        const R = await loadRapier();
        const { sampler, buildings } = this.deps;
        const physics = new PhysicsWorld(R, {
          globe: this.deps.globe,
          heightAt: (lat, lon) => sampler.sample(lat, lon),
          prefetch: (lat, lon, r) => sampler.prefetch(lat, lon, r),
          maxBodies: presetOf(store.settings.value).maxBodies,
          terrainDetails: () => this.deps.craters.details(),
        });
        physics.random = () => this.deps.rng.next();
        this.setupDestruction(physics);
        for (const cell of buildings.loadedCells) physics.addCell(cell);
        this.disposers.push(
          buildings.onCellAdded((c) => {
            physics.addCell(c);
            this.rehide(c);
          }),
        );
        this.disposers.push(buildings.onCellRemoved((c) => physics.removeCell(c)));
        this.physicsValue = physics;
        store.physicsState.value = 'ready';
        return physics;
      } catch (err) {
        console.error('[physics]', err);
        store.physicsState.value = 'error';
        pushToast('error', t.tools.physicsFailed, 8000);
        this.physicsLoading = null;
        return null;
      }
    })();
    return this.physicsLoading;
  }

  get destruction(): Destruction | null {
    return this.destructionValue;
  }

  get explosions(): ExplosionService | null {
    return this.explosionsValue;
  }

  /** Bildschirmwackeln 0…1 (Explosionen). */
  get shake(): number {
    return this.effects.shake;
  }

  /** Zerstörung, Effekte, Ton und Explosionen an die neue Physikwelt hängen. */
  private setupDestruction(physics: PhysicsWorld): void {
    const d = this.deps;
    this.effects.attach(physics.group);
    this.water.attach(physics, physics.group);
    const destruction = new Destruction(physics, {
      material: d.buildings.material,
      hideInCell: hideBuilding,
      showInCell: showBuilding,
      onStatus: (id, status, fp, base, quiet) => this.onBuildingStatus(id, status, fp, base, quiet),
      onLoose: (pos, volume) => {
        const floor = physics.groundY(pos.x, pos.z);
        this.effects.dust(pos, Math.cbrt(volume) * 2, floor);
        const cam = physics.worldToBubble(d.camera.position);
        this.audio.rumble(cam.distanceTo(pos), Math.min(2, Math.cbrt(volume) / 3));
      },
    });
    this.destructionValue = destruction;
    this.explosionsValue = new ExplosionService({
      physics,
      destruction,
      events: d.events,
      effects: this.effects,
      audio: this.audio,
      craters: d.craters,
      cameraWorld: () => this.camWorld.copy(d.camera.position),
      reduceMotion: () => store.settings.value.reduceMotion,
    });
    physics.onRebuild = () => {
      destruction.onBubbleReset();
      this.effects.attach(physics.group);
      this.water.attach(physics, physics.group);
      // Aufgaben laufen weiter: sie erkennen den neuen Frame selbst und räumen auf (Bombe, Rakete)
    };
  }

  /** Statuswechsel eines Gebäudes: Zähler, Ereignis, Feuer, Maske im Fotogrammetrie-Modus. */
  private onBuildingStatus(
    id: number,
    status: BuildingStatus,
    fp: Footprint,
    base: number,
    quiet = false,
  ): void {
    const physics = this.physicsValue;
    const destruction = this.destructionValue;
    if (!physics || !destruction) return;
    store.destroyedBuildings.value = countCollapsed(destruction.statuses);
    if (status === 'intact') return;
    this.deps.events.emit('buildingDestroyed', {
      osmId: id,
      fraction: status === 'collapsed' ? 1 : 0.5,
    });
    if (this.deps.buildingsInMesh() && !this.buildingMasks.has(id)) {
      const poly = fp.polygons[0];
      if (poly) {
        // Das Fotogrammetrie-Gebäude verschwindet oberhalb des Sockels (Spec 7.2, Schritt 3)
        const maskId = this.deps.mask.addPolygon(poly.outer, base + 0.8, {
          lat: fp.lat,
          lon: fp.lon,
          height: base,
        });
        this.buildingMasks.set(id, maskId);
      }
    }
    if (status === 'collapsed' && !quiet) {
      const c = physics.geoToBubble({ lat: fp.lat, lon: fp.lon, height: base });
      this.effects.fire(c.setY(physics.groundY(c.x, c.z) + 1), BUILDING_FIRE_S, 1.5);
    }
  }

  /** Neu geladene Zelle: bereits zerstörte Gebäude wieder ausblenden. */
  private rehide(cell: BuildingCell): void {
    const destruction = this.destructionValue;
    if (!destruction || destruction.statuses.size === 0) return;
    for (const range of cell.data.buildings) {
      if (destruction.statusOf(range.id) !== 'intact') hideBuilding(cell, range);
    }
  }

  /** Explosion an einem Punkt im Blasen-Frame; zeigt danach die Bilanz (Spec M4). */
  detonate(pos: Vector3, tntKg: number, opts: DetonateOptions = {}): ExplosionResult | null {
    const ex = this.explosionsValue;
    if (!ex) return null;
    const result = ex.detonate(pos, tntKg, opts);
    if (opts.toast !== false) pushToast('info', explosionSummary(result), 7000);
    return result;
  }

  private context(physics: PhysicsWorld): ToolContext {
    const d = this.deps;
    return {
      scene: d.scene,
      physics,
      terrain: d.sampler,
      buildings: d.buildings,
      events: d.events,
      camera: d.rig,
      view: d.camera,
      origin: d.origin,
      driving: this.driving,
      rng: d.rng,
      settings: store.settings.value,
      toast: (kind, text) => pushToast(kind, text, 5000),
      effects: this.effects,
      audio: this.audio,
      explosions: this.detonator,
      water: this.water,
      destruction: this.destructionValue,
      craters: d.craters,
      globeFx: this.globeFx,
      addTask: (task) => this.tasks.push(task),
    };
  }

  /** Kontext für Ziele auf dem Globus (Physik nur, falls schon geladen). */
  private globeContext(): GlobeToolContext {
    const physics = this.physicsValue;
    return {
      ...this.context(physics as PhysicsWorld),
      physics,
      explosions: physics ? this.detonator : null,
      world: this.world,
    };
  }

  private select(id: string | null): void {
    const next = id ? (this.registry.get(id) ?? null) : null;
    if (next === this.active) return;
    if (this.active && this.physicsValue) this.active.onDeselect?.(this.context(this.physicsValue));
    this.active = next;
    this.lastParams = next ? store.toolParams.value[next.id] : undefined;
    if (next) this.deps.events.emit('toolSelected', { toolId: next.id });
    // Stufe 5: beim ersten Einsatz ein Hinweis (Spec 8), danach nie wieder
    if (next?.tier === 5 && !store.settings.value.apocalypseHintSeen) {
      store.apocalypseHint.value = true;
    }
    next?.onActivate?.(this.env(next));
    if (next?.needsPhysics) {
      const hadPhysics = this.physicsValue !== null;
      void this.ensurePhysics().then((p) => {
        if (!p || this.active !== next) return;
        // Physik erst jetzt geladen: Zustand erneut übernehmen (z. B. Schwerkraft)
        if (!hadPhysics) next.onActivate?.(this.env(next));
        next.onSelect?.(this.context(p));
      });
    }
  }

  private params(tool: Tool): ParamValues {
    const stored = store.toolParams.value[tool.id] ?? {};
    const out: ParamValues = {};
    for (const p of tool.params) if (p.type !== 'action') out[p.key] = clampParam(p, stored[p.key]);
    return out;
  }

  /** Werkzeug an der Bildschirmposition (NDC) anwenden. */
  async use(ndc: Vector2): Promise<void> {
    const tool = this.active;
    if (!tool || this.busy || store.apocalypseHint.value) return;
    const mode = tool.targetMode ?? 'bubble';
    const agl = this.deps.cameraAgl();
    // Werkzeuge für Blase und Globus (Mega-Bombe) zielen erst aus dem All auf den Globus. Darunter
    // wird die Blase wie sonst an den Zielort verlegt, damit dort Gebäude einstürzen; mit der
    // 5-km-Grenze entschied eine knapp (oder unter Last falsch) gemessene Höhe darüber.
    const high = agl > (mode === 'both' ? BOTH_GLOBE_AGL_M : TOOL_MAX_CAMERA_AGL_M);
    if (mode === 'globe' || (mode === 'both' && high)) {
      this.useGlobe(tool, ndc);
      return;
    }
    if (high) {
      pushToast('info', t.tools.tooHigh, 3000);
      return;
    }
    this.busy = true;
    try {
      const physics = await this.ensurePhysics();
      if (!physics) return;
      const first = this.pick(ndc, physics);
      if (!first) {
        pushToast('info', t.tools.noTarget, 2500);
        return;
      }
      const geo: GeoPoint = this.deps.origin.worldToGeo(first.point);
      const radius = presetOf(store.settings.value).bubbleRadiusM;
      physics.maxBodies = presetOf(store.settings.value).maxBodies;
      if (!physics.contains(geo)) {
        await physics.ensureBubble(geo, radius);
        pushToast('info', t.tools.bubbleMoved, 2500);
      }
      // Nach dem (evtl. asynchronen) Aufbau neu zielen: die Physik kennt jetzt Gelände und Gebäude
      let hit = this.pick(ndc, physics);
      // Der erste Treffer kam evtl. von einer noch groben Kachel (Sehne unter der Oberfläche, bis
      // zu Kilometer daneben); liegt der genaue Treffer außerhalb der Blase, einmal nachziehen
      if (hit && !physics.contains(hit.geo)) {
        await physics.ensureBubble(hit.geo, radius);
        hit = this.pick(ndc, physics);
      }
      if (!hit || this.active !== tool) return;
      tool.onPointerDown?.(hit, this.context(physics), this.params(tool));
    } finally {
      this.busy = false;
    }
  }

  /** Werkzeug auf den Globus anwenden (aus jeder Höhe, ohne Simulationsblase). */
  private useGlobe(tool: Tool, ndc: Vector2): void {
    const target = this.pickGlobe(ndc);
    if (!target) {
      pushToast('info', t.tools.noTarget, 2500);
      return;
    }
    tool.onGlobeTarget?.(target, this.globeContext(), this.params(tool));
  }

  /** Treffer auf Gelände bzw. Gebäuden, sonst auf dem WGS84-Ellipsoid (Kacheln noch nicht da). */
  pickGlobe(ndc: Vector2): GlobeTarget | null {
    const d = this.deps;
    d.camera.updateMatrixWorld();
    _ray.setFromCamera(ndc, d.camera);
    const hit = d.raycastWorld(_ray.ray);
    if (hit) {
      const geo = d.origin.worldToGeo(hit.point);
      return { geo, point: hit.point.clone() };
    }
    // Strahl ins ECEF-Frame des Globus und gegen das Ellipsoid schneiden
    d.globe.updateMatrixWorld();
    const inv = d.globe.matrixWorld.clone().invert();
    const local = _ray.ray.clone().applyMatrix4(inv);
    const p = WGS84_ELLIPSOID.intersectRay(local, new Vector3());
    if (!p) return null;
    const point = p.applyMatrix4(d.globe.matrixWorld);
    const geo = d.origin.worldToGeo(point);
    geo.height = d.sampler.sample(geo.lat, geo.lon) ?? 0;
    return { geo, point };
  }

  /** Raycast gegen Physik (Gelände, Gebäude, Körper) und sichtbare Welt; nächster Treffer. */
  /** Treffer auf noch groben Kacheln gegen das Höhenmodell korrigieren ({@link refineCoarseHit}). */
  private refineCoarseHit(
    ray: Ray,
    hit: { point: Vector3; distance: number } | null,
  ): { point: Vector3; distance: number } | null {
    const { origin, sampler } = this.deps;
    return refineCoarseHit(
      ray,
      hit,
      (p) => origin.worldToGeo(p, _hitGeo),
      (lat, lon) => sampler.sample(lat, lon),
    );
  }

  private pick(ndc: Vector2, physics: PhysicsWorld): WorldHit | null {
    const d = this.deps;
    d.camera.updateMatrixWorld();
    _ray.setFromCamera(ndc, d.camera);
    const ray = _ray.ray.clone();
    const ph: PhysicsHit | null = physics.raycast(ray);
    const wh = this.refineCoarseHit(ray, d.raycastWorld(ray));
    let point: Vector3;
    let normal: Vector3;
    let distance: number;
    if (ph && (!wh || ph.distance <= wh.distance + 0.5)) {
      ({ point, normal, distance } = ph);
    } else if (wh) {
      point = wh.point.clone();
      normal = d.origin.basisAt(point).up.clone();
      distance = wh.distance;
    } else {
      return null;
    }
    const geo = d.origin.worldToGeo(point);
    const usePhysics = ph !== null && point === ph.point;
    const ready = physics.frame !== null;
    return {
      point,
      normal,
      geo,
      distance,
      local: ready ? physics.worldToBubble(point) : new Vector3(),
      localNormal: ready ? physics.dirToBubble(normal) : new Vector3(0, 1, 0),
      body: usePhysics ? ph.body : null,
      buildingId: usePhysics ? ph.buildingId : null,
      ray,
    };
  }

  fixedUpdate(dt: number): void {
    const physics = this.physicsValue;
    if (!physics) return;
    // Kraftfelder (Magnet) wirken im festen Schritt, damit sie nicht von der Bildrate abhängen
    if (this.active?.onUpdate) this.active.onUpdate(dt, this.context(physics));
    // Laufende Aufgaben (Zünder, Bomben); eine Aufgabe darf neue anhängen
    for (let i = 0; i < this.tasks.length; i++) {
      if (this.tasks[i]!(dt)) this.tasks.splice(i--, 1);
    }
    this.water.step(dt);
    physics.step(dt);
    this.destructionValue?.step();
    this.simDt += dt;
  }

  /**
   * `dt` echte Zeit, `scaledDt` mit Zeitskala. Effekte laufen mit der simulierten Zeit (Pause,
   * Zeitlupe, langsame Frames); Globus-Effekte brauchen keine Physik.
   */
  update(dt: number, scaledDt: number, alpha: number, cameraHeightM: number): void {
    this.globeFx.update(scaledDt, cameraHeightM);
    this.driving.update();
    const physics = this.physicsValue;
    if (!physics) return;
    physics.render(alpha, dt);
    const a = this.ambience;
    this.water.render(this.simDt, a.sunDir, a.sky, a.light);
    this.effects.update(this.simDt);
    this.simDt = 0;
    this.driving.render();
  }

  get particleCount(): number {
    return this.physicsValue ? this.effects.particleCount : 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.globeFx.dispose();
    this.driving.dispose();
    this.effects.dispose();
    this.water.dispose();
    this.audio.dispose();
    this.physicsValue?.dispose();
  }
}

/** Gebäude im Zellen-Mesh ausblenden: seine Dreiecke werden entartet (Index-Bereich). */
export function hideBuilding(cell: BuildingCell, range: BuildingRange): void {
  const index = cell.mesh.geometry.index;
  if (!index || range.indexCount === 0) return;
  const arr = index.array;
  const first = arr[range.indexStart]!;
  for (let k = range.indexStart; k < range.indexStart + range.indexCount; k++) arr[k] = first;
  index.addUpdateRange(range.indexStart, range.indexCount);
  index.needsUpdate = true;
}

/** Ausgeblendetes Gebäude wieder zeigen (Original-Indizes aus den Zelldaten). */
export function showBuilding(cell: BuildingCell, range: BuildingRange): void {
  const index = cell.mesh.geometry.index;
  if (!index || range.indexCount === 0) return;
  const arr = index.array;
  const src = cell.data.indices;
  for (let k = range.indexStart; k < range.indexStart + range.indexCount; k++) arr[k] = src[k]!;
  index.addUpdateRange(range.indexStart, range.indexCount);
  index.needsUpdate = true;
}

function countCollapsed(statuses: ReadonlyMap<number, BuildingStatus>): number {
  let n = 0;
  for (const s of statuses.values()) if (s === 'collapsed') n++;
  return n;
}
