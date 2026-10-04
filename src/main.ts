import { render, h } from 'preact';
import './styles.css';
import { pushToast } from './core/store';
import { App } from './ui/App';
import { installErrorBoundary } from './ui/errorBoundary';
import { t } from './ui/i18n';

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function bootstrap(): Promise<void> {
  installErrorBoundary();

  const uiRoot = document.getElementById('ui');
  const canvas = document.getElementById('scene');
  if (!uiRoot || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('index.html fehlt #ui oder #scene');
  }
  render(h(App, {}), uiRoot);

  if (!hasWebGL2()) {
    pushToast('error', t.toast.webglMissing, 60_000);
    return;
  }

  // three.js und die Engine werden als eigener Chunk geladen, damit das
  // UI-Overlay sofort erscheint. Rapier (WASM) folgt später ebenfalls per Lazy Load.
  const { createEngine } = await import('./core/engine');
  const engine = createEngine(canvas);
  engine.loop.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => engine.dispose());
  }
}

void bootstrap();
