/** Deutsche UI-Texte. Jeder sichtbare Text der UI kommt aus dieser Datei. */
export const de = {
  appTitle: 'GlobeBox',
  hud: {
    fps: 'FPS',
    frameMs: 'ms/Frame',
    drawCalls: 'Draw-Calls',
    triangles: 'Dreiecke',
  },
  attribution: {
    label: 'Quellen',
    toggle: 'Quellenangaben ein- oder ausklappen',
    none: 'Noch keine Datenquelle aktiv',
  },
  toast: {
    close: 'Meldung schließen',
    unexpectedError: 'Unerwarteter Fehler. Das Spiel läuft weiter.',
    webglMissing: 'WebGL ist nicht verfügbar. GlobeBox braucht einen Browser mit WebGL 2.',
  },
};

/** Struktur, die jede Sprache erfüllen muss (Werte sind beliebige Strings). */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof de>;
