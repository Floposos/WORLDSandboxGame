import {
  Raycaster,
  Vector2,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Ray,
  type Scene,
} from 'three';
import type { CameraRig } from '../camera/cameraRig';
import type { CameraInput } from '../camera/input';
import { isTyping } from '../camera/input';
import type { EventBus, GameEvents } from '../core/events';
import type { FloatingOrigin } from '../core/floatingOrigin';
import type { Rng } from '../core/random';
import { presetOf } from '../core/settings';
import { pushToast, store } from '../core/store';
import type { GeoPoint } from '../core/types';
import { loadRapier } from '../physics/rapier';
import { PhysicsWorld, type PhysicsHit } from '../physics/world';
import { t } from '../ui/i18n';
import type { BuildingService } from '../world/buildings/buildingService';
import type { HeightSampler } from '../world/heightSampler';
import { Driving } from './driving';
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
}

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

  constructor(private readonly deps: ToolManagerDeps) {
    this.driving = new Driving(deps.rig, () => this.physicsValue);
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
        });
        physics.random = () => this.deps.rng.next();
        for (const cell of buildings.loadedCells) physics.addCell(cell);
        this.disposers.push(buildings.onCellAdded((c) => physics.addCell(c)));
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
    physics.step(dt);
  }

  update(dt: number, alpha: number): void {
    this.driving.update();
    const physics = this.physicsValue;
    if (!physics) return;
    physics.render(alpha, dt);
    this.driving.render();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.driving.dispose();
    this.physicsValue?.dispose();
  }
}
