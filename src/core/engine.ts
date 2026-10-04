import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import { createGameEvents, type EventBus, type GameEvents } from './events';
import { FpsMeter } from './fps';
import { GameLoop } from './loop';
import { Rng } from './random';
import { store } from './store';

export interface Engine {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  events: EventBus<GameEvents>;
  loop: GameLoop;
  rng: Rng;
  dispose(): void;
}

/** Statischer Sternenhimmel als Hintergrund der (noch leeren) Szene. */
function createStarfield(rng: Rng, count = 4000): Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // gleichverteilte Richtung auf der Kugel
    const u = rng.range(-1, 1);
    const phi = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - u * u);
    positions[i * 3] = r * Math.cos(phi);
    positions[i * 3 + 1] = u;
    positions[i * 3 + 2] = r * Math.sin(phi);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false });
  const stars = new Points(geometry, material);
  stars.name = 'starfield';
  stars.frustumCulled = false;
  stars.scale.setScalar(1_000);
  stars.renderOrder = -1;
  return stars;
}

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new Scene();
  scene.background = new Color(0x02030a);

  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10_000);
  camera.position.set(0, 0, 0);

  const rng = new Rng(0x6c0be);
  const stars = createStarfield(rng.fork());
  scene.add(stars);

  const events = createGameEvents();
  const fps = new FpsMeter(60);
  let statsTimer = 0;

  const loop = new GameLoop({
    fixedUpdate: () => {
      // Physik folgt in M3.
    },
    update: (dt) => {
      // langsame Drehung, damit sichtbar ist, dass der Loop läuft
      camera.rotation.y += dt * 0.02;
      // Sterne folgen der Kamera (Skybox-Verhalten)
      stars.position.copy(camera.position);
      renderer.render(scene, camera);

      fps.push(dt);
      statsTimer += dt;
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
  loop.timeScale = store.timeScale.value;
  const unsubscribeTimeScale = store.timeScale.subscribe((v) => (loop.timeScale = v));

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
    events,
    loop,
    rng,
    dispose() {
      loop.stop();
      unsubscribeTimeScale();
      window.removeEventListener('resize', onResize);
      events.clear();
      stars.geometry.dispose();
      (stars.material as PointsMaterial).dispose();
      renderer.dispose();
    },
  };
}
