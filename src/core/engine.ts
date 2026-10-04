import { Color, Group, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import { CameraRig } from '../camera/cameraRig';
import { GlobeCamera } from '../camera/globeCamera';
import { CameraInput } from '../camera/input';
import type { CameraMode } from '../camera/types';
import { arrivalPose, viewDistanceFor, type CameraPose } from '../camera/flyTo';
import { Atmosphere } from '../world/atmosphere/atmosphere';
import { SunLighting } from '../world/atmosphere/lighting';
import { Starfield } from '../world/atmosphere/stars';
import { Geocoder, type GeocodeResult } from '../world/geocoder';
import { GroundService } from '../world/ground';
import { HeightSampler } from '../world/heightSampler';
import { PREVIEW_MAX_CAMERA_HEIGHT_M, TargetPreview } from '../world/targetPreview';
import { CesiumIonProvider } from '../world/providers/CesiumIonProvider';
import { GoogleTilesProvider } from '../world/providers/GoogleTilesProvider';
import { OpenDataProvider } from '../world/providers/OpenDataProvider';
import { ProviderChain, type ChainNotice } from '../world/providers/providerChain';
import type { TileProvider } from '../world/providers/TileProvider';
import { syncAttributions } from '../ui/attributions';
import { t } from '../ui/i18n';
import { createGameEvents, type EventBus, type GameEvents } from './events';
import { createBasis, FloatingOrigin } from './floatingOrigin';
import { FpsMeter } from './fps';
import { GameLoop } from './loop';
import { Rng } from './random';
import { presetOf } from './settings';
import { pushToast, store } from './store';

export interface Engine {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** ECEF-Frame des Globus; Matrix = ECEF → lokaler ENU-Frame des Ursprungs (Floating Origin). */
  globe: Group;
  origin: FloatingOrigin;
  events: EventBus<GameEvents>;
  loop: GameLoop;
  rng: Rng;
  dispose(): void;
}

/** Startansicht: Europa aus dem All. */
const START_POSE: CameraPose = { lat: 35, lon: 10, height: 18_000_000, heading: 0, pitch: -90 };
/** Neigung bei Ankunft nach „Fliege zu“. */
const ARRIVAL_PITCH = -35;

const providerLabels: Record<string, string> = {
  google: 'Google-Tiles',
  'cesium-ion': 'Cesium ion',
  'open-data': 'Open-Data-Modus',
};

function fallbackText(n: ChainNotice): string {
  return t.provider.fallback
    .replace('{failed}', providerLabels[n.failedId] ?? n.failedId)
    .replace('{next}', providerLabels[n.providerId] ?? n.providerId)
    .replace('{reason}', t.provider.reasons[n.reason]);
}

const DAY_SKY = new Color(0x8db4e2);
const DUSK_SKY = new Color(0x2a3550);

/** Himmelsfarbe: am Tag blau, in der Dämmerung dunkel, ab ~60 km Höhe schwarz. */
export function skyColor(heightM: number, sunUp: number, out = new Color()): Color {
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const atmosphere = 1 - smooth(8_000, 60_000, heightM);
  const day = smooth(-0.12, 0.15, sunUp);
  out.setRGB(0, 0, 0).lerp(DUSK_SKY, atmosphere * smooth(-0.3, -0.05, sunUp));
  return out.lerp(DAY_SKY, atmosphere * day);
}

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // Bessere Tiefenauflösung von 0,1 m bis zum Horizont (Bodenkamera); fällt ohne
    // EXT_clip_control automatisch auf den normalen Tiefenpuffer zurück.
    reversedDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.autoClear = false;

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1.6e8);

  const globe = new Group();
  globe.name = 'globe';
  scene.add(globe);
  const events = createGameEvents();
  const origin = new FloatingOrigin(globe, START_POSE, events);
  scene.add(origin.local);

  const rng = new Rng(0x6c0be);
  const stars = new Starfield(rng.fork());
  const lighting = new SunLighting(scene, globe);
  const atmosphere = new Atmosphere(globe);
  const geocoder = new Geocoder({ lang: 'de' });

  // `provider` wird weiter unten gesetzt; die Closures lesen den jeweils aktiven Wert.
  let provider: TileProvider | null = null;
  const ground = new GroundService(origin, () => provider, new HeightSampler());
  const globeCamera = new GlobeCamera(
    camera,
    scene,
    globe,
    canvas,
    (lat, lon) => ground.heightAt(lat, lon),
    () => provider?.supportsBuildingsInMesh ?? true,
  );
  globeCamera.setPose(START_POSE);
  const input = new CameraInput(canvas);
  const rig = new CameraRig(
    { camera, origin, ground, input },
    globeCamera,
    (ray) => provider?.raycast(ray.ray)?.point ?? null,
    (mode) => (store.cameraMode.value = mode),
  );
  const preview = new TargetPreview(origin.local, origin, ground);

  const chain = new ProviderChain({
    providers: [new GoogleTilesProvider(), new CesiumIonProvider(), new OpenDataProvider()],
    events,
    onFallback: (n) => pushToast('warn', fallbackText(n), 8000),
  });
  events.on('providerChanged', ({ providerId }) => {
    provider = chain.active;
    store.provider.value = providerId as typeof store.provider.value;
    provider?.setErrorTarget(presetOf(store.settings.value).tileErrorTarget);
  });

  const startProviders = async (): Promise<void> => {
    store.provider.value = 'loading';
    provider = null;
    try {
      await chain.start({ renderer, scene, camera, globe }, store.settings.value);
    } catch (err) {
      if (err instanceof Error && err.message.includes('überholt')) return;
      store.provider.value = 'error';
      pushToast('error', t.provider.none, 15_000);
    }
  };
  void startProviders();

  const flyToResult = async (result: GeocodeResult): Promise<void> => {
    // Aus Flug-/Bodenmodus: im Globusmodus hinfliegen, danach zurück in den Modus
    const back = rig.mode === 'fly' || rig.mode === 'ground' ? rig.mode : null;
    rig.setMode('globe');
    const groundM = ground.heightAt(result.lat, result.lon) ?? 0;
    await globeCamera.flyTo(
      arrivalPose(result, Math.max(groundM, 0), viewDistanceFor(result.extent), ARRIVAL_PITCH),
      store.settings.value.reduceMotion,
    );
    if (back && rig.mode === 'globe') rig.setMode(back);
  };
  const setCameraMode = (mode: CameraMode): void => rig.setMode(mode);
  store.api.value = { flyToResult, restartProviders: startProviders, setCameraMode };
  if (import.meta.env.DEV) {
    // Nur im Dev-Server: Zugriff für Debugging und Browser-Prüfskripte.
    Object.assign(globalThis, {
      __globebox: {
        scene,
        camera,
        globe,
        globeCamera,
        origin,
        ground,
        rig,
        preview,
        getProvider: () => provider,
      },
    });
  }

  // HUD-Informationen und Ortsname (gedrosselt, nur bei stehender Kamera)
  const pose: CameraPose = { lat: 0, lon: 0, height: 0, heading: 0, pitch: 0 };
  const centerRay = new Raycaster();
  const ndcCenter = new Vector2(0, 0);
  let lastMoveAt = performance.now();
  let lastKey = '';
  let lastReverseKey = '';
  let reverseAbort: AbortController | null = null;
  const updateView = (): void => {
    globeCamera.getPose(pose);
    const groundM = ground.heightAt(pose.lat, pose.lon);
    store.view.value = { lat: pose.lat, lon: pose.lon, height: pose.height, ground: groundM };
    const key = `${pose.lat.toFixed(4)},${pose.lon.toFixed(4)},${Math.round(pose.height / 50)}`;
    const now = performance.now();
    if (key !== lastKey) {
      lastKey = key;
      lastMoveAt = now;
      return;
    }
    if (now - lastMoveAt < 1500 || pose.height > 400_000 || globeCamera.flying) return;
    // Ortsname für den Punkt in der Bildmitte
    centerRay.setFromCamera(ndcCenter, camera);
    const hit = provider?.raycast(centerRay.ray);
    const lat = hit?.geo.lat ?? pose.lat;
    const lon = hit?.geo.lon ?? pose.lon;
    const reverseKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (reverseKey === lastReverseKey) return;
    lastReverseKey = reverseKey;
    reverseAbort?.abort();
    reverseAbort = new AbortController();
    geocoder
      .reverse(lat, lon, reverseAbort.signal)
      .then((r) => (store.placeName.value = r?.label ?? null))
      .catch(() => undefined);
  };

  const fps = new FpsMeter(60);
  let statsTimer = 0;
  let viewTimer = 0;
  let attributionTimer = 0;
  let previewTimer = 0;
  const sky = new Color();
  const skyBasis = createBasis();
  const camGeo = { lat: 0, lon: 0, height: 0 };
  const pointer = new Vector2(0, 0);
  let pointerInside = false;
  const onPointerMove = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    pointerInside = true;
  };
  const onPointerLeave = (): void => {
    pointerInside = false;
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  const previewRay = new Raycaster();
  const updatePreview = (): void => {
    const mode = rig.mode;
    // Im Bodenmodus und mit Pointer-Lock zielt die Bildmitte, sonst der Mauszeiger.
    const useCenter = mode === 'ground' || input.locked;
    if (
      mode === 'follow' ||
      globeCamera.flying ||
      camGeo.height > PREVIEW_MAX_CAMERA_HEIGHT_M ||
      (!useCenter && !pointerInside)
    ) {
      preview.hide();
      return;
    }
    previewRay.setFromCamera(useCenter ? ndcCenter : pointer, camera);
    const hit = provider?.raycast(previewRay.ray);
    // Streifende Treffer am Horizont ergeben nur einen gelben Strich
    if (!hit || hit.distance > Math.max(5_000, 4 * (camGeo.height - hit.geo.height))) {
      preview.hide();
      return;
    }
    preview.show(hit.point, presetOf(store.settings.value).bubbleRadiusM);
  };

  const loop = new GameLoop({
    fixedUpdate: () => {
      // Physik folgt in M3.
    },
    update: (dt) => {
      const sim = store.simTime.value;
      const timeMs = sim.live ? Date.now() : sim.timeMs;
      lighting.update(timeMs);
      atmosphere.sunDirection.copy(lighting.directionWorld);

      rig.update(dt);
      camera.updateMatrixWorld();

      // Floating Origin: am Boden ab 5 km Abstand neu zentrieren (nicht mitten in einer Geste)
      origin.worldToGeo(camera.position, camGeo);
      if (rig.canShiftOrigin) {
        const groundM = ground.heightAt(camGeo.lat, camGeo.lon) ?? 0;
        const d = origin.maybeShift(camera.position, camGeo.height - groundM, [camera]);
        if (d) {
          rig.applyOriginShift(d);
          camera.updateMatrixWorld();
        }
      }
      provider?.update();

      // Sterne blenden in der Atmosphäre aus.
      const h = camGeo.height;
      stars.setVisibility(Math.min(1, Math.max(0, (h - 30_000) / 170_000)));
      stars.sync(camera, globe);
      // SIMPLIFIED: Himmel als Hintergrundfarbe nach Höhe und Sonnenstand, echte Streuung in M5.
      skyColor(h, lighting.directionWorld.dot(origin.basisAt(camera.position, skyBasis).up), sky);
      renderer.setClearColor(sky);

      renderer.info.reset();
      renderer.clear();
      renderer.render(stars.scene, stars.camera);
      renderer.clearDepth();
      renderer.render(scene, camera);

      fps.push(dt);
      statsTimer += dt;
      viewTimer += dt;
      attributionTimer += dt;
      if (viewTimer >= 0.25) {
        viewTimer = 0;
        updateView();
      }
      previewTimer += dt;
      if (previewTimer >= 0.1) {
        previewTimer = 0;
        updatePreview();
      }
      if (attributionTimer >= 1) {
        attributionTimer = 0;
        syncAttributions('provider', provider?.attributions() ?? []);
      }
      if (statsTimer >= 0.25) {
        statsTimer = 0;
        store.stats.value = {
          ...store.stats.value,
          fps: fps.fps,
          frameMs: fps.frameMs,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        };
      }
    },
  });
  // Draw-Calls/Dreiecke über beide Render-Durchgänge (Sterne + Szene) zählen.
  renderer.info.autoReset = false;

  loop.timeScale = store.timeScale.value;
  const unsubscribeTimeScale = store.timeScale.subscribe((v) => (loop.timeScale = v));
  let lastPreset = store.settings.value.preset;
  const unsubscribeSettings = store.settings.subscribe((s) => {
    if (s.preset !== lastPreset) {
      lastPreset = s.preset;
      provider?.setErrorTarget(presetOf(s).tileErrorTarget);
    }
  });

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);

  return {
    renderer,
    scene,
    camera,
    globe,
    origin,
    events,
    loop,
    rng,
    dispose() {
      loop.stop();
      store.api.value = null;
      unsubscribeTimeScale();
      unsubscribeSettings();
      window.removeEventListener('resize', onResize);
      chain.dispose();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      rig.dispose();
      input.dispose();
      preview.dispose();
      globeCamera.dispose();
      atmosphere.dispose();
      stars.dispose();
      events.clear();
      renderer.dispose();
    },
  };
}
