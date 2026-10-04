import { Group, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import { GlobeCamera } from '../camera/globeCamera';
import { arrivalPose, viewDistanceFor, type CameraPose } from '../camera/flyTo';
import { Atmosphere } from '../world/atmosphere/atmosphere';
import { SunLighting } from '../world/atmosphere/lighting';
import { Starfield } from '../world/atmosphere/stars';
import { Geocoder, type GeocodeResult } from '../world/geocoder';
import { CesiumIonProvider } from '../world/providers/CesiumIonProvider';
import { GoogleTilesProvider } from '../world/providers/GoogleTilesProvider';
import { OpenDataProvider } from '../world/providers/OpenDataProvider';
import { ProviderChain, type ChainNotice } from '../world/providers/providerChain';
import type { TileProvider } from '../world/providers/TileProvider';
import { syncAttributions } from '../ui/attributions';
import { t } from '../ui/i18n';
import { createGameEvents, type EventBus, type GameEvents } from './events';
import { FpsMeter } from './fps';
import { GameLoop } from './loop';
import { Rng } from './random';
import { presetOf } from './settings';
import { pushToast, store } from './store';

export interface Engine {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** ECEF-Frame des Globus (Z = Nordpol), in three.js um −90° um X gedreht (Y-up). */
  globe: Group;
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

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.autoClear = false;

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1.6e8);

  const globe = new Group();
  globe.name = 'globe';
  globe.rotation.x = -Math.PI / 2;
  scene.add(globe);
  globe.updateMatrixWorld();

  const rng = new Rng(0x6c0be);
  const stars = new Starfield(rng.fork());
  const lighting = new SunLighting(scene, globe);
  const atmosphere = new Atmosphere(globe);
  const events = createGameEvents();
  const geocoder = new Geocoder({ lang: 'de' });

  // `provider` wird weiter unten gesetzt; die Closure liest den jeweils aktiven Wert.
  let provider: TileProvider | null = null;
  const globeCamera = new GlobeCamera(camera, scene, globe, canvas, (lat, lon) =>
    provider ? provider.sampleHeight(lat, lon) : null,
  );
  globeCamera.setPose(START_POSE);

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
    const ground = provider?.sampleHeight(result.lat, result.lon) ?? 0;
    await globeCamera.flyTo(
      arrivalPose(result, Math.max(ground, 0), viewDistanceFor(result.extent), ARRIVAL_PITCH),
      store.settings.value.reduceMotion,
    );
  };
  store.api.value = { flyToResult, restartProviders: startProviders };
  if (import.meta.env.DEV) {
    // Nur im Dev-Server: Zugriff für Debugging und Browser-Prüfskripte.
    Object.assign(globalThis, {
      __globebox: { scene, camera, globe, globeCamera, getProvider: () => provider },
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
    const ground = provider?.sampleHeight(pose.lat, pose.lon) ?? null;
    store.view.value = { lat: pose.lat, lon: pose.lon, height: pose.height, ground };
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

  const loop = new GameLoop({
    fixedUpdate: () => {
      // Physik folgt in M3.
    },
    update: (dt) => {
      const sim = store.simTime.value;
      const timeMs = sim.live ? Date.now() : sim.timeMs;
      lighting.update(timeMs);
      atmosphere.sunDirection.copy(lighting.directionWorld);

      globeCamera.update(dt);
      camera.updateMatrixWorld();
      provider?.update();

      // Sterne blenden in der Atmosphäre aus.
      const h = pose.height;
      stars.setVisibility(Math.min(1, Math.max(0, (h - 30_000) / 170_000)));
      stars.sync(camera);

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
      globeCamera.dispose();
      atmosphere.dispose();
      stars.dispose();
      events.clear();
      renderer.dispose();
    },
  };
}
