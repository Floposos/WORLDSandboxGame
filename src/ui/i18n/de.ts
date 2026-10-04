/** Deutsche UI-Texte. Jeder sichtbare Text der UI kommt aus dieser Datei. */
export const de = {
  appTitle: 'GlobeBox',
  provider: {
    loading: 'Lade Welt …',
    fallback: '{failed} nicht verfügbar ({reason}), {next} aktiv',
    none: 'Keine Kartenquelle erreichbar. Bitte Internetverbindung prüfen.',
    names: {
      google: 'Google 3D-Tiles',
      'cesium-ion': 'Cesium ion',
      'open-data': 'Open Data',
    },
    reasons: {
      'no-key': 'kein Key',
      unauthorized: 'Key ungültig',
      quota: 'Kontingent erschöpft',
      network: 'Netzwerkfehler',
      timeout: 'Zeitüberschreitung',
      other: 'Fehler',
    },
  },
  search: {
    label: 'Ort suchen',
    placeholder: 'Ort suchen … (Strg+K)',
    noResults: 'Nichts gefunden',
    error: 'Suche gerade nicht erreichbar',
    results: 'Suchergebnisse',
  },
  hud: {
    fps: 'FPS',
    frameMs: 'ms/Frame',
    drawCalls: 'Draw-Calls',
    triangles: 'Dreiecke',
    altitude: 'Höhe',
    aboveGround: 'über Grund',
    source: 'Quelle',
  },
  time: {
    label: 'Datum und Uhrzeit für den Sonnenstand',
    now: 'Jetzt',
    live: 'Live',
  },
  settings: {
    open: 'Einstellungen und Keys',
    title: 'Einstellungen',
    providerLabel: 'Kartenquelle',
    providerAuto: 'Automatisch (beste verfügbare)',
    googleKey: 'Google Maps API-Key (Map Tiles API)',
    cesiumToken: 'Cesium ion Access-Token',
    keysHint:
      'Optional. Keys bleiben nur in diesem Browser (localStorage) und sind für jeden sichtbar, der die Seite nutzt. Beschränke sie in der Google- bzw. Cesium-Konsole auf deine Domain.',
    preset: 'Grafik',
    presets: { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' },
    reduceMotion: 'Bildschirmwackeln, Blitze und Flüge reduzieren',
    showFps: 'Leistungsanzeige',
    save: 'Speichern und neu laden',
    cancel: 'Abbrechen',
    saved: 'Einstellungen gespeichert',
    notSaved: 'Einstellungen gelten nur für diese Sitzung (Speicher blockiert)',
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
