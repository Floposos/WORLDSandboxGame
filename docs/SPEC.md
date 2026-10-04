<!--
  Verbindliche Fallback-Spezifikation: Florians Startauftrag vom 2026-10-04, wortgetreu übernommen.
  Nicht inhaltlich ändern. Abweichungen und Entscheidungen stehen in DECISIONS.md, der Stand in PROGRESS.md.
-->
<!-- prettier-ignore-start -->

# AUFTRAG: Baue „GlobeBox“, ein browserbasiertes Sandbox-Spiel auf einem 3D-Erdglobus

Du bist Lead-Engineer, Game-Developer und Technical Artist in einer Person.
Du baust dieses Projekt von Grund auf in diesem (leeren) Git-Repository.
Arbeite selbstständig, gründlich und meilensteinweise. Lies diesen gesamten Prompt,
bevor du die erste Datei anlegst, und halte dich während der gesamten Arbeit daran.

---

## 0. Wie du arbeiten sollst (Arbeitsmodus)

1. **Erst verstehen, dann planen, dann bauen.** Lege vor dem ersten Code eine Datei
   `docs/PLAN.md` an. Sie enthält deine Architektur, die Meilensteine, offene Risiken
   und die Annahmen, die du triffst.
2. **Arbeite strikt meilensteinweise (M0 bis M8, siehe Abschnitt 9).** Ein Meilenstein gilt
   erst als fertig, wenn ALLE seine Abnahmekriterien erfüllt sind.
3. **Nach jedem Meilenstein:**
   - `npm run typecheck`, `npm run lint` und `npm run test` müssen grün sein
   - `npm run build` muss ohne Fehler durchlaufen
   - Starte die App und prüfe sie im Browser (Screenshot bzw. Sichtprüfung)
   - Aktualisiere `docs/PLAN.md` (Häkchen, Erkenntnisse, neue Risiken)
   - Committe mit einer aussagekräftigen Nachricht im Format `feat(M3): …`, `fix: …` oder `chore: …`
   - Gib mir eine kurze Zusammenfassung: was fertig ist, was bekannt kaputt ist und was als Nächstes kommt.
     Danach **wartest du auf mein „weiter“**.
4. **API-Dokumentation nie aus dem Gedächtnis voraussetzen.** Bibliotheken wie
   `3d-tiles-renderer`, `three` und `@dimforge/rapier3d-compat` ändern ihre APIs.
   Prüfe vor der Nutzung die aktuelle Doku bzw. die README im installierten Paket
   (`node_modules/<pkg>/README.md`, Typdefinitionen) und pinne die Versionen in `package.json`.
5. **Prüfe jeden externen Endpunkt, bevor du dich darauf verlässt.** Teste jede URL aus
   Abschnitt 5 einmal manuell (z. B. mit `curl -I`), bevor du Code darauf aufbaust.
   Wenn ein Endpunkt nicht mehr funktioniert, suche eine gleichwertige kostenlose
   Alternative und dokumentiere sie.
6. **Keine Platzhalter-Implementierungen, die als fertig verkauft werden.** Wenn etwas
   vereinfacht ist, markiere es mit `// SIMPLIFIED:` und erkläre im Kommentar, warum.
7. **Fragen stellst du nur bei echten Blockern.** Das betrifft z. B. einen fehlenden API-Key,
   ohne den ein Abnahmekriterium unerreichbar ist. Alles andere entscheidest du selbst
   und dokumentierst die Entscheidung in `docs/DECISIONS.md` (kurzes ADR-Format:
   Kontext, Entscheidung, Konsequenz).
8. **Kleine, nachvollziehbare Commits.** Committe keine generierten Dateien, Keys,
   `.env` oder `node_modules`.

---

## 1. Vision

GlobeBox ist ein Sandbox-Spiel, das komplett im Browser läuft. Der Spieler sieht die Erde
wie in Google Earth: als 3D-Globus, von dem aus er stufenlos bis auf Straßenebene zoomt.
Er sucht sich einen beliebigen echten Ort aus und experimentiert dort mit Werkzeugen
verschiedener Eskalationsstufen. Das reicht von harmlos (Kisten stapeln, Wetter ändern)
bis brutal (Fliegerbomben, Meteoriteneinschläge, Tornados, Mond-Absturz).

- **Maßstab:** Ziel 1:1 zur echten Erde, Untergrenze 1:2. Wenn du aus Leistungsgründen
  skalierst, dann nur zentral über eine Konstante `WORLD_SCALE` in `src/core/constants.ts`.
  Alle Distanzen, Radien und Geschwindigkeiten müssen diese Konstante respektieren.
- **Plattform:** statische Website ohne Backend, gehostet auf GitHub Pages.
- **Lizenz:** MIT für den Code. Die Daten behalten ihre eigenen Lizenzen.
- **Ton:** spielerisch-physikalisch angenähert (Universe Sandbox, Teardown, Besiege).
  KEINE militärisch exakte Simulation, KEINE realen Waffenbau- oder Einsatzinformationen,
  KEINE Darstellung realer Opfer. Menschen gibt es nur als abstrakte NPC-Punkte bzw.
  -Kapseln, die bei Druckwellen umfallen oder wegfliegen (Ragdoll-Kapseln, kein Blut, kein Gore).

---

## 2. Harte Randbedingungen (nicht verhandelbar)

1. **Läuft ohne jeden API-Key.** Die Open-Data-Variante (Abschnitt 5.3) muss vollständig
   spielbar sein. Keys schalten nur bessere Grafik frei.
2. **Keine Keys im Repo.** Keys kommen entweder aus `.env.local`
   (`VITE_GOOGLE_MAPS_KEY`, `VITE_CESIUM_ION_TOKEN`) oder werden zur Laufzeit im
   Einstellungsdialog eingegeben und in `localStorage` gespeichert (try/catch um jeden Zugriff).
   Lege eine `.env.example` mit leeren Werten an. `.env*` außer `.env.example` steht in `.gitignore`.
   Beim GitHub-Pages-Build werden **keine** Keys eingebaut.
3. **Nutzungsregeln der APIs einhalten:**
   - Nominatim: maximal 1 Anfrage pro Sekunde, Debounce, eigener Kontext, keine Autocomplete-Flut.
     Bevorzuge Photon für die Suche.
   - Overpass: Anfragen bündeln, Ergebnisse im Speicher und in IndexedDB cachen (TTL 7 Tage),
     maximal 1 gleichzeitige Anfrage, bei HTTP 429 exponentielles Backoff.
   - Google 3D Tiles: kein dauerhaftes Caching und kein Offline-Speichern der Tiles,
     Google-Logo und Attribution sichtbar halten.
   - Overpass-Abfragen nur für den aktuellen Spielbereich, nie für ganze Länder.
4. **Attribution:** Jede genutzte Datenquelle erscheint (a) dynamisch in der
   Attributionsleiste unten rechts, sobald sie aktiv ist, und (b) in `ATTRIBUTIONS.md`.
5. **Performance-Budget:** 60 FPS auf einem Mittelklasse-Laptop (integrierte GPU, 2022)
   im Preset „Mittel“, 30 FPS im Preset „Niedrig“ auf schwacher Hardware.
   Initialer JS-Bundle unter 1,5 MB gzip (Rapier-WASM und schwere Module per Lazy Load nachladen).
6. **Nur TypeScript im Strict-Modus.** `any` nur mit Begründungskommentar.
7. **Barrierearm genug:** UI vollständig per Tastatur bedienbar, Kontrast ausreichend,
   Option „Bildschirmwackeln/Blitze reduzieren“.

---

## 3. Tech-Stack (verbindlich, Versionen beim Installieren pinnen)

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript (strict) | Typsicherheit bei Koordinatenmathematik |
| Build | Vite | schnell, einfache GitHub-Pages-Integration |
| Rendering | three.js | volle Kontrolle für Game-Effekte |
| Globus/Tiles | `3d-tiles-renderer` (NASA-AMMOS) inkl. Plugins für Google-, Cesium-ion- und Quantized-Mesh-/Imagery-Quellen | streamt 3D Tiles & Globus, bringt Globe-Controls mit |
| Physik | `@dimforge/rapier3d-compat` | WASM, schnell, Vite-kompatibel ohne Extra-Konfig |
| VFX | eigene GPU-Partikel (InstancedMesh + Shader) oder `three.quarks` | Explosionen, Rauch, Feuer |
| UI | Preact + Signals (oder Vanilla, falls schlanker) | leichtgewichtig |
| State | eigener kleiner Store + typisierter EventBus | keine schwere Lib nötig |
| Tests | Vitest (Unit), Playwright (Smoke-E2E) | |
| Lint/Format | ESLint (typescript-eslint) + Prettier | |
| CI/CD | GitHub Actions → GitHub Pages | |

Falls eine Lib sich als ungeeignet erweist, darfst du wechseln. Dokumentiere das dann in `docs/DECISIONS.md`.

---

## 4. Architektur

### 4.1 Verzeichnisstruktur

```
/src
  main.ts                   – Bootstrapping, Lazy-Loading schwerer Module
  /core
    constants.ts            – WGS84, WORLD_SCALE, Physik-Konstanten
    geo.ts                  – WGS84 ↔ ECEF ↔ ENU, Distanzen, Bearing
    floatingOrigin.ts       – Origin-Rebasing
    loop.ts                 – Game-Loop (fixed physics step + variable render)
    events.ts               – typisierter EventBus
    store.ts                – globaler Spielzustand
    settings.ts             – Grafik-Presets, Keys, Accessibility
    random.ts               – seedbarer PRNG (Determinismus für Replays)
  /world
    providers/
      TileProvider.ts       – Interface
      GoogleTilesProvider.ts
      CesiumIonProvider.ts
      OpenDataProvider.ts   – AWS Terrain + Sentinel-2 + OSM
      providerChain.ts      – Fallback-Logik
    terrain/
      heightSampler.ts      – Geländehöhe an lat/lon abfragen
      craterPatch.ts        – lokale Geländeverformung
    buildings/
      overpass.ts           – Abfrage + Cache
      extrude.ts            – Footprint → Mesh
      destructible.ts       – Gebäude → Physik-Proxy (Voronoi/Grid-Bruchstücke)
    water/                  – Ozean-Shader, Flutlevel
    atmosphere/             – Himmel, Sonne nach Uhrzeit/Datum, Nebel
    weather/                – Open-Meteo, Regen/Schnee/Wind
  /physics
    world.ts                – Rapier-Init, Simulationsblase
    bodies.ts               – Fabriken für Box, Kugel, Auto, Trümmer, NPC-Kapsel
    blast.ts                – Druckwelle → Impulse
    budget.ts               – Body-Limit, Sleeping, Despawn
  /tools
    Tool.ts                 – Interface + Registry
    tier0/ tier1/ tier2/ tier3/ tier4/ tier5/  – ein Werkzeug pro Datei
  /vfx
    particles.ts, explosion.ts, smoke.ts, fire.ts, shockwave.ts, debris.ts, screenshake.ts
  /camera
    globeCamera.ts, flyCamera.ts, groundCamera.ts, followCamera.ts, cameraManager.ts
  /replay
    recorder.ts, player.ts  – Ringpuffer der letzten 30 s
  /ui
    App.tsx, Toolbar.tsx, ToolParams.tsx, Search.tsx, Settings.tsx,
    KeysDialog.tsx, Attribution.tsx, Hud.tsx, Stats.tsx, Help.tsx
  /scene
    serialize.ts            – Szene ↔ JSON, Teilen über URL-Hash
/public
/tests
  unit/                     – geo, blast, crater, overpass-parser, provider-chain
  e2e/                      – Playwright-Smoketest
/docs
  PLAN.md, DECISIONS.md, ARCHITECTURE.md, TOOLS.md
ATTRIBUTIONS.md
README.md
LICENSE (MIT)
.env.example
.github/workflows/deploy.yml
.github/workflows/ci.yml
```

### 4.2 Koordinatensysteme (exakt umsetzen)

- **WGS84:** a = 6 378 137 m, f = 1/298.257223563, b = a·(1−f), e² = f·(2−f)
- **Geodätisch → ECEF:**
  N = a / √(1 − e²·sin²φ)
  X = (N + h)·cosφ·cosλ, Y = (N + h)·cosφ·sinλ, Z = (N·(1−e²) + h)·sinφ
- **ECEF → geodätisch:** iterativ (Bowring) oder geschlossen. Genauigkeit unter 1 mm.
- **ENU:** Für den Ursprung (φ₀, λ₀, h₀) wird eine Rotationsmatrix ECEF → ENU gebildet.
  Alle Spielobjekte, die Physik und die VFX leben in einem **lokalen ENU-Frame**
  um den aktuellen Fokuspunkt (Y = Up in three.js-Konvention, dokumentiere die Achsenzuordnung).
- **Floating Origin:** Wenn sich die Kamera mehr als 5 km vom aktuellen Ursprung entfernt,
  wird der Ursprung neu gesetzt. Alle lokalen Objekte und Rapier-Bodies werden verschoben,
  die Tiles-Gruppe wird neu transformiert. Danach wird `originShifted` emittiert.
- Unit-Tests: Roundtrip geodätisch → ECEF → geodätisch für Äquator, Pole, Datumsgrenze,
  Mount Everest und Marianengraben. Toleranz 1 mm.

### 4.3 Game-Loop

- Fester Physik-Schritt mit 60 Hz (Akkumulator, maximal 5 Substeps pro Frame).
- Gerendert wird bei variabler Framerate. Physik-Transforms werden interpoliert.
- Zeitskala: 0 (Pause), 0,1 / 0,25 / 0,5 (Zeitlupe), 1 und 2. Die Zeitskala wirkt auf
  Physik und VFX, nicht auf die UI.

### 4.4 EventBus (typisiert)

Mindestens diese Events:

```ts
type GameEvents = {
  originShifted: { newOriginEcef: Vec3; deltaLocal: Vec3 };
  toolSelected: { toolId: string };
  impact: { posLocal: Vec3; energyJ: number; source: string };
  explosion: { posLocal: Vec3; tntEquivalentKg: number; airburstHeightM: number };
  buildingDestroyed: { osmId: number; fraction: number };
  craterCreated: { center: GeoPoint; radiusM: number; depthM: number };
  providerChanged: { providerId: string; reason: string };
  weatherChanged: { state: WeatherState };
  statsUpdated: { bodies: number; particles: number; destroyedBuildings: number };
};
```

### 4.5 Tool-Interface (jedes Werkzeug implementiert genau das)

```ts
export interface ToolContext {
  scene: THREE.Scene;
  physics: PhysicsWorld;
  vfx: VfxSystem;
  terrain: HeightSampler;
  buildings: BuildingService;
  events: EventBus<GameEvents>;
  camera: CameraManager;
  rng: Rng;
  settings: Settings;
}

export interface ToolParam {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  min?: number; max?: number; step?: number; unit?: string;
  options?: { value: string; label: string }[];
  default: number | string | boolean;
}

export interface Tool {
  id: string;
  name: string;            // deutsch, UI-Text
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  icon: string;            // Name eines lokalen SVG-Icons
  description: string;
  params: ToolParam[];
  hotkey?: string;
  onSelect?(ctx: ToolContext): void;
  onDeselect?(ctx: ToolContext): void;
  onPointerDown?(hit: WorldHit, ctx: ToolContext, params: Record<string, unknown>): void;
  onPointerMove?(hit: WorldHit | null, ctx: ToolContext): void; // Vorschau/Zielkreis
  onUpdate?(dt: number, ctx: ToolContext): void;
}
```

Werkzeuge registrieren sich in einer `ToolRegistry`. Die Toolbar wird vollständig aus der
Registry generiert, ohne hartcodierte Listen in der UI. Jedes Werkzeug zeigt beim Zielen
eine Vorschau (Zielkreis mit Wirkungsradius auf dem Gelände).

---

## 5. Datenquellen & Provider

### 5.1 TileProvider-Interface

```ts
interface TileProvider {
  id: 'google' | 'cesium-ion' | 'open-data';
  label: string;
  requiresKey: boolean;
  isAvailable(settings: Settings): Promise<boolean>; // inkl. Test-Request
  attach(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  detach(): void;
  update(): void;                       // pro Frame
  raycast(ray: THREE.Ray): WorldHit | null;
  attributions(): AttributionEntry[];   // dynamisch, je nach sichtbaren Daten
  supportsBuildingsInMesh: boolean;     // true bei Fotogrammetrie
}
```

### 5.2 Fallback-Kette

1. **Google Photorealistic 3D Tiles** (über die Map Tiles API, nur mit Key).
   Root: `https://tile.googleapis.com/v1/3dtiles/root.json?key=…`
2. **Cesium ion** (nur mit Token): Cesium World Terrain + Bildmaterial + Cesium OSM Buildings
3. **Open-Data** (immer verfügbar, Details in 5.3)

`providerChain.ts` probiert die Quellen der Reihe nach. Schlägt eine fehl (401, 403, 429,
Netzwerkfehler, Quota), wird automatisch auf die nächste gewechselt. Dann wird
`providerChanged` emittiert und ein Toast angezeigt („Google-Tiles nicht verfügbar,
Open-Data-Modus aktiv“). Der Spieler kann den Provider in den Einstellungen auch manuell wählen.

### 5.3 Open-Data-Modus (Pflicht, ohne Keys)

| Zweck | Quelle | Details |
|---|---|---|
| Höhenmodell | AWS Terrain Tiles (Terrarium) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Höhe = (R·256 + G + B/256) − 32768 m. Daraus Gelände-Mesh-Kacheln mit LOD bauen (Quadtree auf dem Ellipsoid, Kachel-Mesh z. B. 64×64, Skirts gegen Risse). |
| Satellitenbild | EOX Sentinel-2 cloudless (WMTS, WebMercator) | Endpunkt und Layer-Namen beim Start verifizieren. Den Jahrgang mit CC-BY-Lizenz bevorzugen und die Lizenz je Jahrgang in `ATTRIBUTIONS.md` vermerken. |
| Globale Ansicht | NASA GIBS / Blue Marble | für niedrige Zoomstufen (Ansicht aus dem All) |
| Gebäude | Overpass API (OSM) | siehe 5.4 |
| Wasser/Küsten | Ozean überall dort, wo die Höhe ≤ 0 ist, plus OSM-`natural=water` für Seen in der Spielblase | |

### 5.4 Gebäude (OSM via Overpass)

- Endpunkt: `https://overpass-api.de/api/interpreter`. Lege einen Fallback-Mirror als
  konfigurierbare Liste an.
- Abfrage nur für die **Spielblase** (Radius standardmäßig 600 m um den Fokus,
  einstellbar von 200 bis 1500 m). Beispiel:
  ```
  [out:json][timeout:25];
  (
    way["building"](around:{R},{lat},{lon});
    relation["building"](around:{R},{lat},{lon});
  );
  out geom tags;
  ```
- Höhe bestimmen: `height` (m) → `building:levels × 3,2 m` → Standard nach Gebäudetyp
  (Wohnhaus 9 m, Industrie 8 m, Kirche 20 m, Hochhaus-Tags beachten). `min_height` und
  `building:part` berücksichtigen, soweit es einfach machbar ist.
- Extrusion: Footprint (lat/lon) → ENU → `ShapeGeometry`/Extrusion, Basis auf Geländehöhe
  (niedrigsten Footprint-Punkt sampeln). Dachform: flach (SIMPLIFIED).
- Material: abhängig von `building:material` und `roof:colour`, sonst eine neutrale Palette.
  Optional: Textur-Atlas mit Fenstern.
- Cache: Speicher-LRU + IndexedDB, Schlüssel = gerundete Kachel (z. B. Geohash Präzision 6).
- Parser und Höhenlogik werden unit-getestet (Fixtures als JSON in `tests/fixtures/`).

### 5.5 Weitere APIs

| Zweck | Quelle | Regeln |
|---|---|---|
| Ortssuche | Photon `https://photon.komoot.io/api/?q=…&limit=5`, Fallback Nominatim `https://nominatim.openstreetmap.org/search?format=jsonv2&q=…` | Debounce 400 ms, für Nominatim max. 1 req/s |
| Reverse-Geocoding (Ortsname im HUD) | Photon `/reverse` | nur beim Stillstand der Kamera, gedrosselt |
| Echtwetter | Open-Meteo `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,is_day` | Button „Echtes Wetter übernehmen“, Cache 15 min |
| Sonnenstand | lokal berechnet (NOAA-Algorithmus, kein API-Call) | aus Datum, Uhrzeit, lat/lon |

---

## 6. Rendering, Kamera & Welt

### 6.1 Kameras

- **Globus-Kamera (Standard):** Navigation wie in Google Earth. Linke Maus dreht den
  Globus („grab the earth“), rechte Maus oder Strg neigt und dreht, das Mausrad zoomt
  zum Cursor hin. Trägheit, Kollision mit dem Gelände (nie unter die Oberfläche),
  sanfte Begrenzung beim Neigen nahe dem Boden.
- **Flugkamera:** WASD + QE, Shift für Boost. Geschwindigkeit skaliert mit der Höhe über Grund.
- **Bodenkamera:** Ego-Perspektive mit 1,8 m Augenhöhe, Gehen und Springen (Rapier-Character-Controller).
- **Verfolgerkamera:** hängt sich automatisch an Projektile und Meteore (abschaltbar)
  und kehrt nach dem Einschlag zurück.
- **„Fliege zu“:** gekrümmter Flugpfad (zuerst steigen, dann reisen, dann sinken),
  Dauer abhängig von der Distanz, mit Easing.
- Umschalten per Taste (`1` bis `4`) und über die UI.

### 6.2 Atmosphäre & Licht

- Atmosphären-Schimmer am Globusrand (Rayleigh-ähnlicher Fresnel-Shader reicht)
- Sonne nach echtem Datum und echter Uhrzeit (Zeitregler in der UI), Nachtseite dunkel
  mit optionaler Stadtlicht-Textur (NASA Black Marble, Lizenz prüfen)
- Nebel und Dunst abhängig von der Höhe
- Schatten nur in der Spielblase (Cascaded Shadow Maps oder eine einzelne Shadow-Map
  um den Fokus, gesteuert über die Presets)

### 6.3 Wasser

- Ozean-Shader auf dem Ellipsoid (Wellen-Normalmaps, Fresnel)
- Flut-Werkzeug: Ein lokaler Wasserspiegel in der Spielblase steigt auf die Zielhöhe
  (eine Ebene mit Clipping am Gelände reicht, SIMPLIFIED).

### 6.4 Grafik-Presets

| Preset | Tile-Fehlertoleranz | Schatten | Max. Physik-Bodies | Max. Partikel | Blasenradius |
|---|---|---|---|---|---|
| Niedrig | hoch | aus | 300 | 5 000 | 300 m |
| Mittel | mittel | 1 Kaskade | 1 000 | 20 000 | 600 m |
| Hoch | niedrig | 3 Kaskaden | 2 500 | 60 000 | 1 000 m |
| Ultra | sehr niedrig | 3 Kaskaden + weich | 5 000 | 150 000 | 1 500 m |

Optional: Automatische Erkennung beim ersten Start (kurzer Benchmark von 3 Sekunden).

---

## 7. Physik, Zerstörung & Effekte

### 7.1 Simulationsblase

- Rapier simuliert nur innerhalb einer Kugel um den Fokuspunkt (Radius siehe Presets).
- Kollisionsgeometrie für das Gelände: Ein Heightfield-Collider wird aus dem `heightSampler`
  für die Blase erzeugt (z. B. 128×128 Samples) und bei Ursprungsverschiebung oder
  Kraterbildung neu aufgebaut.
- Gebäude erhalten zunächst **statische** Box- bzw. Convex-Hull-Collider. Erst bei
  Zerstörung werden sie zu dynamischen Bruchstücken.
- Body-Budget: Wird das Limit überschritten, despawnen die ältesten und kleinsten Trümmer
  zuerst (mit Ausblenden). Schlafende Bodies frieren nach 10 s ein und werden zu statischen
  Instanced-Meshes zusammengefasst.

### 7.2 Zerstörungs-Pipeline (Kernstück, sehr sorgfältig umsetzen)

Problem: Fotogrammetrie-Tiles (Google und teilweise Cesium) sind ein durchgehendes Mesh
ohne einzelne Gebäude.

Lösung:
1. Bei einem Einschlag mit Wirkungsradius R werden alle OSM-Gebäude im Radius 1,5·R geladen
   (Cache zuerst).
2. **Maskierung:** Im Tiles-Material wird per Shader-Injection (`onBeforeCompile`) ein
   Discard-/Clip-Bereich eingesetzt. Dafür gibt es eine Liste von Polygonen bzw. Kreisen
   in ENU, maximal 32 gleichzeitig, als Uniform-Array oder Data-Texture. Innerhalb der Maske
   wird das Fotogrammetrie-Mesh ausgeblendet.
3. An derselben Stelle erscheinen die **extrudierten OSM-Gebäude als Proxies**. Sie werden
   farblich an das Fotogrammetrie-Mesh angenähert, indem eine Durchschnittsfarbe am Footprint
   gesampelt wird (SIMPLIFIED ist erlaubt).
4. Ein Proxy wird **vorab gebrochen**: Er wird in Stockwerke (Höhe 3,2 m) und pro Stockwerk
   in ein 2D-Voronoi-Muster mit 4 bis 12 Zellen zerlegt, abhängig von der Größe und dem Preset.
   Die Bruchstücke sind zunächst inaktiv und Teil eines zusammenhängenden Meshes.
5. Erhält ein Gebäude einen Impuls über einem Schwellwert, werden die betroffenen
   Bruchstücke zu dynamischen Rapier-Bodies. Stockwerke ohne Stütze darunter fallen nach
   (einfacher Strukturtest: Hat ein Bruchstück keinen Kontakt zu einem Stück darunter
   oder zum Boden, wird es dynamisch).
6. Staub- und Rauchwolke beim Einsturz, Trümmer bleiben liegen (Budget beachten).
7. Status pro Gebäude (`intact | damaged | collapsed`) wird im Store gehalten und
   in der Szenen-Serialisierung gespeichert.

Im Open-Data-Modus entfällt die Maskierung, weil die Gebäude dort bereits Proxies sind.

### 7.3 Druckwelle (spielerische Näherung)

- Eingabe: TNT-Äquivalent W (kg), Detonationshöhe.
- Skalierte Distanz Z = R / W^(1/3). Spitzenüberdruck nach Kinney-Graham,
  gekappt und auf Spielwerte gemappt. Implementiere das als reine Funktion in
  `physics/blast.ts` mit Unit-Tests auf Monotonie und Grenzwerte.
- Daraus wird pro Body im Radius ein Impuls berechnet: Richtung vom Zentrum weg,
  Stärke ∝ Überdruck × Angriffsfläche (approximiert durch die AABB-Fläche).
  Optional: Sichtlinien-Abschattung durch einen Raycast.
- Die Schockwelle erscheint visuell als expandierender, verzerrender Ring (Screen-Space-
  Refraction oder ein einfacher Ring-Shader). Die Ausbreitungsgeschwindigkeit nähert sich
  der Schallgeschwindigkeit (343 m/s) an und darf für Lesbarkeit optional verlangsamt werden.
- Bildschirmwackeln abhängig von Distanz und Energie (respektiert „Bewegung reduzieren“).

### 7.4 Krater

- Kraterradius und -tiefe aus der Einschlagsenergie, über eine vereinfachte
  Skalierungsfunktion (dokumentiert in `docs/TOOLS.md`, monotone Funktion,
  Werte plausibel und spielbar).
- Umsetzung: Ein **Height-Patch** (Data-Texture mit Höhen-Offsets) in der Spielblase wird
  im Gelände-Shader (Open-Data) bzw. als zusätzliches Mesh mit Maskierung (Tiles-Modus) angewendet.
  Form: Schüssel plus Auswurfwall.
- Der Heightfield-Collider wird neu gebaut, und der `heightSampler` berücksichtigt die Patches.
- Mehrere Krater überlagern sich additiv, maximal N Patches pro Blase.

### 7.5 VFX

- GPU-Partikelsystem mit Instancing und Pooling, damit zur Laufzeit keine Allokationen anfallen.
- Explosion: Blitz (kurzes Punktlicht), Feuerball (Additive-Sprites mit Noise),
  aufsteigende Rauchsäule (Billboards, Lebensdauer 20 bis 60 s, vom Wind verweht),
  Funken, Trümmerpartikel.
- Feuer an getroffenen Gebäuden (lokale Emitter, erlöschen nach einer Zeit).
- Bei großen Explosionen (Stufe 5): Pilzwolke als stilisierte Rauchsäule mit Ring,
  rein visuell und ohne Strahlungs- oder Opferdarstellung.
- Wetter: Regen und Schnee als Partikelvolumen um die Kamera, Wind beeinflusst Rauch
  und Partikel, Blitze bei Gewitter.

### 7.6 Audio

- WebAudio: Explosion (Lautstärke und Tiefpass abhängig von der Distanz, Schall-Verzögerung
  = Distanz / 343 m/s), Wind, Regen, Einsturz-Rumpeln.
- Nur selbst erzeugte (prozedurale) oder CC0-Sounds. Herkunft in `ATTRIBUTIONS.md` vermerken.
- Master-Lautstärke und Stummschalten in der UI.

---

## 8. Werkzeuge (vollständige Liste, jedes mit Parametern)

Dokumentiere jedes Werkzeug in `docs/TOOLS.md`: Parameter, Formel/Näherung, Grenzen.

**Stufe 0 – Bauen**
- `place-box`: Kiste (Größe 0,5 bis 5 m, Material Holz/Beton/Metall → Dichte)
- `place-ball`: Kugel (Radius, Material)
- `place-car`: einfaches Auto (Chassis + 4 Räder, Rapier Vehicle Controller oder Raycast-Fahrzeug), optional fahrbar
- `place-npcs`: Gruppe abstrakter NPC-Kapseln (Anzahl 1 bis 200), wandern zufällig umher, fallen bei Impulsen um
- `place-wall`: Mauer ziehen (Start- und Endpunkt, Höhe), aus stapelbaren Blöcken
- `eraser`: platzierte Objekte entfernen

**Stufe 1 – Natur**
- `time-of-day`: Uhrzeit und Datum
- `weather`: klar/bewölkt/Regen/Schnee/Gewitter/Nebel, Windrichtung und -stärke, Button „echtes Wetter“
- `flood`: Wasserspiegel in der Blase anheben (0 bis 50 m)
- `gravity`: Gravitation 0 bis 3 g (wirkt global auf die Blase)

**Stufe 2 – Physik**
- `throw`: Objekt aus der Kamera werfen (Geschwindigkeit)
- `wrecking-ball`: Abrissbirne an einem Kran-Punkt (Masse, Schwungweite)
- `force-push`: Kraftstoß als Kegel, ohne Explosion
- `magnet`: zieht Bodies an

**Stufe 3 – Explosionen**
- `grenade`: kleine Explosion (TNT 0,2 bis 2 kg)
- `aerial-bomb`: Fliegerbombe fällt aus der Zielhöhe (Fallzeit physikalisch, Verfolgerkamera), Sprengkraft 50 bis 1 000 kg TNT
- `demolition-charge`: an Gebäudewände anheften, gemeinsam per Taste zünden
- `rocket`: Rakete von der Kameraposition zum Ziel

**Stufe 4 – Katastrophen**
- `meteor`: Durchmesser 1 bis 100 m, Geschwindigkeit 11 bis 72 km/s, Eintrittswinkel.
  Kinetische Energie E = ½·m·v² wird in TNT umgerechnet (1 t TNT = 4,184·10⁹ J).
  Leuchtspur in der Atmosphäre, Krater, Druckwelle.
- `tornado`: wandert über das Gelände (Pfad oder zufällig), Wirbel-Kraftfeld
  (tangential + radial + aufwärts), saugt Objekte und Trümmer an und reißt Bruchstücke von Gebäuden ab
- `earthquake`: Stärke 1 bis 10 (spielerische Skala). Das Heightfield bzw. die Kamera bebt,
  Gebäude bekommen oszillierende Impulse, schwache Gebäude stürzen zuerst ein.
- `volcano`: Kegel wächst aus dem Gelände, Lavapartikel, Rauchsäule
- `tsunami`: Welle läuft vom Wasser aufs Land (Wasserwand-Mesh + Kraftfeld, SIMPLIFIED)

**Stufe 5 – Apokalypse**
- `mega-bomb`: Sprengkraft 1 kt bis 50 Mt (TNT-Äquivalent). Zeigt Wirkungsradien als Ringe
  (Feuerball, schwere/leichte Zerstörung), Druckwelle über die Blase hinaus als rein visueller
  Ring auf dem Globus, Pilzwolke. Abstrakt und spielerisch, ohne Opferzahlen.
- `asteroid`: 1 bis 50 km, wird aus der Globusansicht gezielt. Einschlag mit globalem
  Effekt-Overlay (Ring auf dem Globus, Himmel verdunkelt, Staubschleier).
- `moon-drop`: Der Mond wird auf die Erde gelenkt. Rein filmische Sequenz mit Zeitraffer
  und Kamerafahrt, am Ende Reset-Angebot.
- Werkzeuge der Stufe 5 öffnen beim ersten Einsatz einen Hinweis-Dialog
  („Rein fiktive, stilisierte Darstellung“).

**Globale Werkzeuge:** Rückgängig (letzte 20 Aktionen, soweit sinnvoll), „Blase zurücksetzen“
(lädt Gebäude neu, entfernt Krater und Trümmer), Pause, Zeitlupe, Replay.

---

## 9. Meilensteine & Abnahmekriterien

### M0 – Projektgerüst
- Vite + TS strict, ESLint, Prettier, Vitest, Playwright, Ordnerstruktur aus 4.1
- `README.md` (Rohfassung), `LICENSE` (MIT), `.env.example`, `.gitignore`, `ATTRIBUTIONS.md` (Rohfassung)
- CI-Workflow: install → typecheck → lint → test → build bei jedem Push/PR
- Deploy-Workflow: Build → GitHub Pages (`actions/configure-pages`, `actions/upload-pages-artifact`,
  `actions/deploy-pages`), Vite-`base` korrekt auf `/<repo-name>/` gesetzt
- ✅ Abnahme: `npm run dev` zeigt eine leere Szene mit FPS-Anzeige, CI läuft grün,
  `docs/PLAN.md` existiert

### M1 – Globus
- Open-Data-Provider: Globus mit Satellitenbild und Gelände, LOD vom All bis etwa 100 m Höhe
- Globus-Kamera mit allen Interaktionen aus 6.1
- Ortssuche mit „Fliege zu“
- Attributionsleiste dynamisch
- Atmosphäre und Sonne nach Uhrzeit
- Google- und Cesium-Provider mit Key-Dialog und Fallback-Kette
- ✅ Abnahme: Ohne Key kann ich vom All nach „Zugspitze“ fliegen und erkenne das Relief.
  Mit Google-Key sehe ich in „New York“ 3D-Gebäude. Ein ungültiger Key löst einen sauberen
  Fallback mit Toast aus. Die Unit-Tests für `geo.ts` sind grün.

### M2 – Bodenkontakt
- Floating Origin, ENU-Frame, Raycast auf Gelände und Tiles (`WorldHit` mit lat/lon/h + Normale)
- Flug-, Boden- und Verfolgerkamera
- `heightSampler` mit Caching
- Zielkreis-Vorschau auf dem Gelände
- ✅ Abnahme: In Tokio und in Buenos Aires ist am Boden kein Jittern sichtbar.
  Die Bodenkamera läuft eine Straße entlang, ohne einzusinken. Der Wechsel zwischen
  diesen beiden Städten funktioniert per Suche.

### M3 – Physik & Bauen
- Rapier per Lazy Load, Simulationsblase, Heightfield-Collider
- Werkzeuge der Stufe 0 und Stufe 2
- OSM-Gebäude laden (Open-Data: sichtbar; Tiles-Modus: nur als unsichtbare Collider)
- Body-Budget, Sleeping, Despawn
- ✅ Abnahme: 200 Kisten fallen auf ein Hausdach in Berlin-Mitte und bleiben liegen,
  im Preset „Mittel“ mit über 50 FPS. Ein Auto ist fahrbar.

### M4 – Explosionen & Zerstörung
- Druckwelle (7.3), VFX (7.5), Audio (7.6)
- Zerstörungs-Pipeline inklusive Maskierung (7.2)
- Krater (7.4)
- Werkzeuge der Stufe 3
- ✅ Abnahme: Eine Fliegerbombe (500 kg) auf einen Häuserblock in Hamburg erzeugt einen
  Krater, ein bis drei Gebäude stürzen sichtbar stockwerksweise ein, Trümmer fliegen,
  eine Rauchsäule bleibt stehen. Im Google-Modus ist an der Stelle kein Fotogrammetrie-Gebäude
  mehr sichtbar. Die Framerate fällt kurzzeitig nicht unter 30 FPS (Preset „Mittel“).

### M5 – Natur & Katastrophen
- Werkzeuge der Stufen 1 und 4, Echtwetter von Open-Meteo, Wasser bzw. Flut
- ✅ Abnahme: Ein Tornado zieht durch ein Wohngebiet und reißt Bruchstücke heraus.
  Ein Meteor mit 50 m Durchmesser hinterlässt einen plausiblen Krater. „Echtes Wetter“
  in London setzt Regen bzw. Wolken passend zur API-Antwort.

### M6 – Apokalypse
- Werkzeuge der Stufe 5, Effekte in Globus-Ansicht, Hinweis-Dialog
- ✅ Abnahme: Ein Mega-Bomben-Einschlag ist aus dem All als Ring bzw. Wolke sichtbar.
  Der Mond-Absturz läuft als Sequenz ohne Absturz des Spiels, danach funktioniert der Reset.

### M7 – Komfort
- Replay (Ringpuffer der letzten 30 s, Wiedergabe mit freier Kamera), Zeitlupe, Undo
- Szene speichern und laden (JSON-Datei) sowie per URL-Hash teilen
  (Ort, Kamera, Uhrzeit, Wetter und eine kompakte Liste der Aktionen mit Seed für deterministisches Nachspielen)
- Einstellungen: Presets, Auto-Benchmark, Steuerung, Lautstärke, Barrierefreiheit, Provider-Wahl, Keys
- Hilfe-Overlay (`H`) mit allen Tastenkürzeln
- ✅ Abnahme: Ein geteilter Link reproduziert Ort und Ablauf einer Bombenszene sichtbar gleich.

### M8 – Release
- Leistung profilieren und optimieren (siehe Abschnitt 11), Bundle-Analyse
- `README.md` final: GIF bzw. Screenshots, Features, Live-Link, lokale Entwicklung,
  optionale Keys einrichten (Schritt für Schritt inkl. HTTP-Referrer-Beschränkung auf die eigene Domain),
  Steuerung, Datenquellen, Lizenz, Beitragen
- `CONTRIBUTING.md` mit einer Anleitung „Ein neues Werkzeug hinzufügen“ in 5 Schritten
- Issue-Templates (Bug/Feature)
- Playwright-Smoketest: App lädt, Suche funktioniert (gemockt), Werkzeug ist auswählbar,
  ein Klick auf das Gelände erzeugt eine Explosion ohne Konsolenfehler
- Tag `v1.0.0` und ein GitHub Release mit Changelog
- ✅ Abnahme: Die GitHub-Pages-URL lädt ohne Keys in unter 5 s (Breitband) und
  alle Werkzeuge funktionieren im Open-Data-Modus.

---

## 10. UI/UX-Spezifikation

- **Layout:** Werkzeugleiste unten mittig, gruppiert nach Stufen. Die Stufen sind farblich
  kodiert (grün → gelb → orange → rot → violett → schwarz-rot).
- **Parameter-Panel** rechts für das aktive Werkzeug (Schieberegler mit Einheit, z. B.
  „500 kg TNT“, „30 km/s“).
- **Suche** oben links mit Vorschlägen, `Strg+K` oder `/` fokussiert sie.
- **HUD** oben rechts: Ortsname, Koordinaten, Höhe über Grund, FPS (optional), Body- und
  Partikelzähler, zerstörte Gebäude.
- **Attribution** unten rechts, kompakt mit aufklappbaren Details.
- **Statistik nach Einschlag** (Toast): Energie in TNT-Äquivalent, Kraterdurchmesser,
  Anzahl beschädigter Gebäude. Keine Opferzahlen.
- **Sprache:** Die UI ist auf Deutsch. Alle Texte stehen in `src/ui/i18n/de.ts`, damit
  Englisch später leicht ergänzt werden kann (lege `en.ts` gleich mit an).
- **Mobil:** Touch-Gesten für den Globus (Pinch, Zwei-Finger-Drehen). Die Werkzeugleiste
  ist wischbar. Auf schwachen Geräten wird automatisch das Preset „Niedrig“ gewählt.
- **Erster Start:** kurzes Onboarding mit 3 Karten (Navigation, Werkzeug wählen, auf die Erde klicken).

### Tastenkürzel (Standard)
| Taste | Aktion |
|---|---|
| 1 bis 4 | Kameramodus |
| Leertaste | Pause |
| T | Zeitlupe umschalten |
| R | Replay |
| Strg+Z | Rückgängig |
| H | Hilfe |
| Tab | Werkzeugleiste fokussieren |
| Esc | Werkzeug abwählen |

---

## 11. Performance-Regeln

- Keine Allokationen im Hot Path (`Vector3`/`Matrix4` als Scratch-Objekte wiederverwenden)
- Instancing für gleiche Meshes (Kisten, Trümmer, NPCs)
- Partikel-Pools, Trümmer-Pools
- Tiles: Fehlertoleranz und Speicherlimit an das Preset koppeln, Tiles außerhalb des Sichtfelds freigeben
- Overpass, Geländedekodierung und Voronoi-Bruch nach Möglichkeit in **Web Workern**
- Rapier im Hauptthread (einfacher) oder optional im Worker. Begründe die Entscheidung in `DECISIONS.md`.
- Ein `stats.ts`-Panel zeigt Frame-Zeit, Draw-Calls, Dreiecke, Bodies, Partikel und Tile-Speicher
- Vor M8: Profiling-Session dokumentieren (Szenario „500-kg-Bombe in Hamburg“, gemessene
  FPS pro Preset, ergriffene Optimierungen)

---

## 12. Qualität & Tests

- **Unit (Vitest):** geo (Roundtrips, ENU), blast (Monotonie, Grenzwerte), Kraterskalierung,
  Terrarium-Dekodierung, Overpass-Parser und Höhenregeln, Provider-Fallback (gemockte fetch-Antworten),
  Szenen-Serialisierung (Roundtrip), seedbarer PRNG (Determinismus)
- **E2E (Playwright):** Smoketest aus M8. Externe APIs per Route-Mocking abfangen,
  damit die CI nicht von Drittdiensten abhängt.
- **Kein Test spricht echte externe APIs an.**
- Fehlerbehandlung: Jeder Netzwerkaufruf hat Timeout, Retry mit Backoff und eine
  nutzerfreundliche Fehlermeldung. Die App stürzt nie wegen eines API-Fehlers ab.
- Globaler Error-Boundary-Toast statt einem weißen Bildschirm.

---

## 13. Sicherheit & Recht

- Keys nur client-seitig und nie geloggt. Die README erklärt, dass Keys im Browser sichtbar
  sind und deshalb auf die eigene Domain beschränkt werden müssen.
- Keine Analytics, kein Tracking, keine Cookies. Eingegebene Suchbegriffe gehen nur an den Geocoder.
- `ATTRIBUTIONS.md` mit Tabelle: Quelle, Nutzung, Lizenz, Link, erforderlicher Attributionstext.
  Mindestens: OpenStreetMap (ODbL), AWS Terrain Tiles bzw. ihre Ursprungsquellen,
  EOX Sentinel-2 cloudless (Jahrgangslizenz!), NASA GIBS, Google (falls aktiv), Cesium (falls aktiv),
  Open-Meteo (CC BY 4.0), Photon/Komoot, Nominatim, three.js, Rapier, 3d-tiles-renderer und alle Sounds bzw. Texturen.
- Inhaltliche Leitlinie: rein fiktive Sandbox. Keine realen Waffenspezifikationen, keine Anleitung
  zu realen Schäden, keine Opferdarstellung, keine politischen oder realen Ereignis-Szenarien als Spielinhalt.

---

## 14. Definition of Done (gesamtes Projekt)

- [ ] Alle Meilensteine M0 bis M8 sind abgenommen
- [ ] Live-Version auf GitHub Pages ist ohne Key voll spielbar
- [ ] Mit Google-Key erscheinen fotorealistische Städte und die Zerstörung funktioniert per Maskierung
- [ ] CI ist grün, Tests sind vorhanden und sinnvoll
- [ ] README, CONTRIBUTING, ATTRIBUTIONS, DECISIONS, TOOLS und ARCHITECTURE sind vollständig
- [ ] Keine Keys, Secrets oder großen Binärdateien in der Git-Historie
- [ ] Release `v1.0.0` ist getaggt

---

## 15. Start

Beginne jetzt mit diesen Schritten:
1. Lies die aktuelle Doku von `3d-tiles-renderer`, `three` und `@dimforge/rapier3d-compat`.
2. Prüfe die Endpunkte aus Abschnitt 5 mit `curl`.
3. Schreibe `docs/PLAN.md` und `docs/ARCHITECTURE.md`.
4. Setze **M0** um.

Danach berichtest du kurz und wartest auf mein „weiter“.

<!-- prettier-ignore-end -->
