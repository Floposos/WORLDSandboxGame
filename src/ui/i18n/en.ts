import type { Messages } from './de';

/** English UI texts (kept in sync with de.ts by the type checker). */
export const en: Messages = {
  appTitle: 'GlobeBox',
  hud: {
    fps: 'FPS',
    frameMs: 'ms/frame',
    drawCalls: 'Draw calls',
    triangles: 'Triangles',
  },
  attribution: {
    label: 'Sources',
    toggle: 'Expand or collapse source attributions',
    none: 'No data source active yet',
  },
  toast: {
    close: 'Close message',
    unexpectedError: 'Unexpected error. The game keeps running.',
    webglMissing: 'WebGL is not available. GlobeBox needs a browser with WebGL 2.',
  },
};
