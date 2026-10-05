import {
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
import type { CameraInput } from '../camera/input';
import { isTyping } from '../camera/input';
import type { EventBus, GameEvents } from '../core/events';
import type { FloatingOrigin } from '../core/floatingOrigin';
import type { Rng } from '../core/random';
import { presetOf } from '../core/settings';
import { pushToast, store } from '../core/store';
import type { GeoPoint } from '../core/types';
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
  type Tool,
  type ToolContext,
  type WorldHit,
} from './Tool';

/** Werkzeuge wirken nur, wenn die Kamera tiefer als das über dem Boden ist. */
export const TOOL_MAX_CAMERA_AGL_M = 5_000;
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
}

/** Brenndauer eines getroffenen Gebäudes in s. */
const BUILDING_FIRE_S = 45;

const _ndc = new Vector2();
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
  /** Für Werkzeuge: Explosion samt Bilanz-Toast (die Physik steht, wenn Werkzeuge laufen). */
  private readonly detonator: Detonator = {
    detonate: (pos, tnt, opts) => this.detonate(pos, tnt, opts)!,
  };

  constructor(private readonly deps: ToolManagerDeps) {
    this.driving = new Driving(deps.rig, () => this.physicsValue);
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
      if (e.code === 'Escape' && !isTyping(e) && store.activeToolId.value) {
        // Esc gibt im Flug-/Bodenmodus zuerst die Maus frei (Browser); dann Werkzeug abwählen
        if (!deps.input.locked) store.activeToolId.value = null;
      }
    });
    const unsub = store.activeToolId.subscribe((id) => this.select(id));
    this.disposers.push(unsub);
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
    const destruction = new Destruction(physics, {
      material: d.buildings.material,
      hideInCell: hideBuilding,
      showInCell: showBuilding,
      onStatus: (id, status, fp, base) => this.onBuildingStatus(id, status, fp, base),
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
      // Aufgaben laufen weiter: sie erkennen den neuen Frame selbst und räumen auf (Bombe, Rakete)
    };
  }

  /** Statuswechsel eines Gebäudes: Zähler, Ereignis, Feuer, Maske im Fotogrammetrie-Modus. */
  private onBuildingStatus(id: number, status: BuildingStatus, fp: Footprint, base: number): void {
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
    if (status === 'collapsed') {
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
      addTask: (task) => this.tasks.push(task),
    };
  }

  private select(id: string | null): void {
    const next = id ? (this.registry.get(id) ?? null) : null;
    if (next === this.active) return;
    if (this.active && this.physicsValue) this.active.onDeselect?.(this.context(this.physicsValue));
    this.active = next;
    if (next) this.deps.events.emit('toolSelected', { toolId: next.id });
    if (next?.needsPhysics) {
      void this.ensurePhysics().then((p) => {
        if (p && this.active === next) next.onSelect?.(this.context(p));
      });
    }
  }

  private params(tool: Tool): ParamValues {
    const stored = store.toolParams.value[tool.id] ?? {};
    const out: ParamValues = {};
    for (const p of tool.params) out[p.key] = clampParam(p, stored[p.key]);
    return out;
  }

  /** Werkzeug an der Bildschirmposition (NDC) anwenden. */
  async use(ndc: Vector2): Promise<void> {
    const tool = this.active;
    if (!tool || this.busy) return;
    if (this.deps.cameraAgl() > TOOL_MAX_CAMERA_AGL_M) {
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
      const hit = this.pick(ndc, physics);
      if (!hit || this.active !== tool) return;
      tool.onPointerDown?.(hit, this.context(physics), this.params(tool));
    } finally {
      this.busy = false;
    }
  }

  /** Raycast gegen Physik (Gelände, Gebäude, Körper) und sichtbare Welt; nächster Treffer. */
  private pick(ndc: Vector2, physics: PhysicsWorld): WorldHit | null {
    const d = this.deps;
    d.camera.updateMatrixWorld();
    _ray.setFromCamera(ndc, d.camera);
    const ray = _ray.ray.clone();
    const ph: PhysicsHit | null = physics.raycast(ray);
    const wh = d.raycastWorld(ray);
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
    physics.step(dt);
    this.destructionValue?.step();
    this.simDt += dt;
  }

  /** `dt` echte Zeit. Effekte laufen mit der simulierten Zeit (Pause, Zeitlupe, langsame Frames). */
  update(dt: number, alpha: number): void {
    this.driving.update();
    const physics = this.physicsValue;
    if (!physics) return;
    physics.render(alpha, dt);
    this.effects.update(this.simDt);
    this.simDt = 0;
    this.driving.render();
  }

  get particleCount(): number {
    return this.physicsValue ? this.effects.particleCount : 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.driving.dispose();
    this.effects.dispose();
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
