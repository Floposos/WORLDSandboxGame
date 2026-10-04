import type { Messages } from './de';

/** English UI texts (kept in sync with de.ts by the type checker). */
export const en: Messages = {
  appTitle: 'GlobeBox',
  provider: {
    loading: 'Loading world …',
    fallback: '{failed} unavailable ({reason}), {next} active',
    none: 'No map source reachable. Please check your internet connection.',
    names: {
      google: 'Google 3D Tiles',
      'cesium-ion': 'Cesium ion',
      'open-data': 'Open Data',
    },
    reasons: {
      'no-key': 'no key',
      unauthorized: 'invalid key',
      quota: 'quota exceeded',
      network: 'network error',
      timeout: 'timeout',
      other: 'error',
    },
  },
  search: {
    label: 'Search place',
    placeholder: 'Search place … (Ctrl+K)',
    noResults: 'Nothing found',
    error: 'Search currently unavailable',
    results: 'Search results',
  },
  hud: {
    fps: 'FPS',
    frameMs: 'ms/frame',
    drawCalls: 'Draw calls',
    triangles: 'Triangles',
    altitude: 'Altitude',
    aboveGround: 'above ground',
    source: 'Source',
  },
  time: {
    label: 'Date and time for the sun position',
    now: 'Now',
    live: 'Live',
  },
  settings: {
    open: 'Settings and keys',
    title: 'Settings',
    providerLabel: 'Map source',
    providerAuto: 'Automatic (best available)',
    googleKey: 'Google Maps API key (Map Tiles API)',
    cesiumToken: 'Cesium ion access token',
    keysHint:
      'Optional. Keys stay in this browser only (localStorage) and are visible to anyone using the page. Restrict them to your domain in the Google or Cesium console.',
    preset: 'Graphics',
    presets: { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' },
    reduceMotion: 'Reduce screen shake, flashes and flights',
    showFps: 'Performance display',
    save: 'Save and reload',
    cancel: 'Cancel',
    saved: 'Settings saved',
    notSaved: 'Settings apply to this session only (storage blocked)',
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
