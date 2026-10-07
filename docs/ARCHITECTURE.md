# GlobeBox – Architektur

Dieses Dokument beschreibt den Soll-Aufbau. Was davon bereits existiert, steht in [PLAN.md](PLAN.md).

## Überblick

```
┌──────────────────────────── Browser (statische Seite, kein Backend) ───────────────────────────┐
│                                                                                                 │
│  index.html ─► main.ts ──► UI-Overlay (Preact + Signals)  ◄─── store (Signals) ◄──┐            │
│                   │                                                               │            │
│                   └─ lazy ─► core/engine ─► GameLoop ─┬─ fixedUpdate 60 Hz ─► physics (Rapier, lazy WASM)
│                                                       │                           │            │
│                                                       └─ update (variabel) ─┬─► world (TileProvider, Terrain, Gebäude, Wasser, Atmosphäre, Wetter)
│                                                                             ├─► tools (ToolRegistry)
│                                                                             ├─► vfx (GPU-Partikel)
│                                                                             ├─► camera (CameraManager)
│                                                                             └─► replay (Ringpuffer)
│                                                                                                 │
│  EventBus<GameEvents> verbindet die Systeme (impact, explosion, originShifted, …)               │
│  Web Worker: Overpass-Parsing, Terrarium-Dekodierung, Voronoi-Bruch                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
          │ fetch (Timeout, Retry/Backoff, Cache)
          ▼
 AWS Terrarium · EOX Sentinel-2 · NASA GIBS · Overpass · Photon/Nominatim · Open-Meteo · (Google 3D Tiles) · (Cesium ion)
```

## Schichten und Verantwortungen

| Modul      | Verantwortung                                                                                                   | Hängt ab von                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `core/`    | Konstanten, Koordinaten, Loop, Events, Store, Settings, PRNG, Floating Origin                                   | – (kein three.js außer in `engine.ts`/`floatingOrigin.ts`) |
| `world/`   | Sichtbare und abfragbare Welt: Tile-Provider, Höhenabfrage, Krater-Patches, Gebäude, Wasser, Atmosphäre, Wetter | `core`, three.js, 3d-tiles-renderer                        |
| `physics/` | Rapier-Welt in der Simulationsblase, Body-Fabriken, Druckwelle, Budget                                          | `core`, Rapier (lazy)                                      |
| `tools/`   | Ein Werkzeug pro Datei, gemeinsames `Tool`-Interface, `ToolRegistry`                                            | `ToolContext` (keine direkten Importe aus UI)              |
| `vfx/`     | Partikel-Pools, Explosion, Rauch, Feuer, Schockwelle, Trümmer, Screenshake                                      | `core`, three.js                                           |
| `camera/`  | Globus-, Flug-, Boden-, Verfolgerkamera, Umschalten, „Fliege zu“                                                | `core`, `world` (Höhe, Raycast)                            |
| `replay/`  | Ringpuffer der letzten 30 s, Wiedergabe                                                                         | `core`, `physics`                                          |
| `scene/`   | Szene ↔ JSON, URL-Hash                                                                                          | `core`, `tools`                                            |
| `ui/`      | HTML-Overlay; liest nur aus `store`, schreibt nur über Aktionen/Events                                          | `core/store`, i18n                                         |

Regel: Die UI kennt keine Engine-Objekte. Sie liest Signals aus `store` und löst Aktionen aus.
Die Engine schreibt Zustand (gedrosselt, z. B. Stats 4×/s) in den Store. Hot-Path-Daten bleiben in den Systemen.

## Koordinatensysteme

1. **WGS84 geodätisch** (φ, λ, h) – Ein-/Ausgabe, Suche, Serialisierung. `GeoPoint` in Grad/Metern.
2. **ECEF** (X, Y, Z) in Metern, `Float64` (JS-`number`). Formeln aus Auftrag 4.2; ECEF → geodätisch iterativ (Bowring), Ziel < 1 mm.
3. **Lokaler ENU-Frame** um den Ursprung O (φ₀, λ₀, h₀). Alles Spielerische (Objekte, Physik, VFX, Kamera-Nahbereich) lebt hier in `Float32`-tauglichen Größenordnungen.

**Achsenzuordnung in three.js (Y-up, rechtshändig):**

| three.js | ENU                  |
| -------- | -------------------- |
| +x       | Ost                  |
| +y       | Oben (Up)            |
| −z       | Nord (also +z = Süd) |

Rotation ECEF → ENU (Standard), danach Umsortierung (E, N, U) → (x, y, z) = (E, U, −N).
Die Tiles (3d-tiles-renderer liefert ECEF) hängen in einer Gruppe, deren Matrix = `ENU_from_ECEF` (inkl. Translation −O) ist.
So sind Tiles und Spielobjekte im selben lokalen Frame.

**Floating Origin** (`core/floatingOrigin.ts`, ADR-016): Die three.js-Welt _ist_ der lokale Frame. Die Gruppe `globe`
trägt `matrix = ECEF → lokal` (`matrixAutoUpdate = false`), Spielobjekte hängen in der Gruppe `local` (Szenenkind ohne
Transform). Entfernt sich die Kamera mehr als max(5 km × `WORLD_SCALE`, 2 × Höhe über Grund) vom Ursprung, wird O auf
den Fußpunkt der Kamera (h = 0) gesetzt. D = M_neu · M_alt⁻¹ wird auf Kamera und alle Kinder von `local` angewandt
(später auch Rapier-Bodies), der `CameraRig` rechnet die Zustände der Kameras um, dann folgt
`originShifted { origin, newOriginEcef, deltaLocal, matrix }`. Im Globusmodus wird nur ohne Geste und Trägheit
verschoben, damit die internen Vektoren der `GlobeControls` nicht mitten in einer Bewegung kippen.
Hilfen: `worldToGeo`, `geoToWorld`, `basisAt(pos)` (Ost/Nord/Oben als Weltrichtungen).

## Kameras

`camera/cameraRig.ts` schaltet zwischen `globe` (GlobeControls + „Fliege zu“), `fly`, `ground` und `follow`
(Tasten 1–4, Modusleiste, `store.cameraMode`). Flug- und Bodenkamera speichern Kurs/Neigung relativ zur lokalen
ENU-Basis am Ort der Kamera (`camera/orientation.ts`), die Bodenkamera ihre Position sogar geodätisch und ist damit
unabhängig von Ursprungsverschiebungen. Boden kommt von `world/ground.ts` (`GroundService.below`): Raycast auf das
gerenderte Mesh (nur wenn es Gebäude enthält oder keine Provider-Höhe existiert), sonst Provider-Höhe, sonst
`heightSampler`. Grobe oder unsinnige Mesh-Treffer werden verworfen (ADR-015). Außerhalb des Globusmodus setzt die
Kamera Near/Far selbst (Near ab 0,1 m, Far = Horizont + 9 km Gebirge); der Tiefenpuffer ist reversed-Z.

## Game-Loop

`core/loop.ts`: `FixedStepAccumulator` (rein, unit-getestet) + `GameLoop` (requestAnimationFrame).

- Physik: fester Schritt 1/60 s, max. 5 Substeps pro Frame, überschüssige Zeit wird verworfen.
- Render: variable Rate; Physik-Transforms werden mit `alpha` interpoliert.
- Zeitskala ∈ {0, 0,1, 0,25, 0,5, 1, 2} wirkt auf Physik und VFX (`scaledDt`), nicht auf UI und Kamera.
- Frame-Zeiten > 250 ms (Tab im Hintergrund) werden gekappt.

## Events

`core/events.ts`: synchroner, typisierter `EventBus<GameEvents>` (Event-Liste aus Auftrag 4.4).
Ein werfender Listener wird geloggt und stoppt die Zustellung nicht.

## Provider und Fallback-Kette

```
ProviderChain.start(ctx, settings)          ctx = { renderer, scene, camera, globe }  (ADR-011)
  ├─ google      Key gesetzt? attach(): Root-Tileset laden = Test (ADR-013)   400/401/403/429/Netz/20 s ⇒ weiter + Toast
  ├─ cesium-ion  Token gesetzt? attach(): Asset 1 (Terrain) + 2 (Bing) + 96188 (OSM Buildings)   dito
  └─ open-data   immer
        TilesRenderer + TerrariumMeshPlugin (AWS Terrarium, maxZoom 15)
          overlay: XYZTilesOverlay(EOX Sentinel-2 2025 (Standard, ADR-025) | 2016 | GIBS Blue Marble, per Probe-Kachel gewählt, ADR-012)
        errorTarget = Preset × 1/20 (ADR-014)
        M3: + OSM-Gebäude als extrudierte Proxies (Overpass, um die Bildmitte, ADR-019)
```

Ohne Key wird ein Provider still übersprungen. Alle Provider hängen ihre `tiles.group` in die Gruppe `globe`
(ECEF, um −90° um X gedreht, damit „oben“ am Nordpol +Y ist). `GlobeCamera` (`src/camera/globeCamera.ts`) kapselt
`GlobeControls` und den „Fliege zu“-Flug (`flyTo.ts`: Steigen, Reisen auf dem Großkreis, Sinken; smootherstep).

Auch nach dem Start kann ein Provider ausfallen (Quota, 429 beim Tile-Laden). Dann wechselt die Kette zur Laufzeit,
emittiert `providerChanged` und zeigt einen Toast. Der Nutzer kann den Provider manuell festlegen (`settings.provider`).

## Gebäude (M3)

`world/buildings/`: `BuildingService.update(fokus, radius)` (1×/s, Kamera unter 6 km) ermittelt die Geohash-6-Zellen
um den Fokus (`geohash.ts`), holt fehlende aus `BuildingCache` (Speicher + IndexedDB) oder per `OverpassClient`
(Rechteck über bis zu 4 Zellen, Mirror-Liste, 1 Anfrage/s). `overpass.ts` setzt Wege und Multipolygone zu Ringen
zusammen, `heights.ts` wendet die Höhenregeln an, `extrude.ts` erzeugt pro Zelle ein Mesh in einem eigenen
ENU-Frame (Zellmitte) mit Fassaden-UVs für das Fensterraster (`material.ts`). Die Zellgruppe hängt in `globe`
(Matrix Zell-Frame → ECEF), so bleiben Vertex-Koordinaten klein. Sichtbar nur mit Open Data; bei Google/Cesium
bleiben die Meshes unsichtbar und dienen nur als Collider und Raycast-Ziel.

## Physik und Werkzeuge (M3)

```
ToolManager (tools/toolManager.ts)
  ├─ Klick → Raycast (Physik + Welt) → ensureBubble(Ziel) → tool.onPointerDown(hit, ctx, params)
  ├─ fixedUpdate(1/60 s): tool.onUpdate (Magnet) → PhysicsWorld.step
  └─ update(alpha): Driving (F, W/A/S/D) → PhysicsWorld.render (Interpolation, Ausblenden)
PhysicsWorld (physics/world.ts, Rapier lazy über physics/rapier.ts)
  ├─ Blase: eigener ENU-Frame (Mitte auf Geländehöhe), Gruppe unter globe (ADR-020)
  ├─ Heightfield 128 × 128 (terrain.ts), Gebäude als feste Trimesh-Collider je Gebäude (ADR-021)
  ├─ SimBody: Rapier-Körper + Darstellung (InstancedPool für Kisten/Kugeln/NPCs, eigene Objekte für Autos)
  └─ Budget (budget.ts): Despawn Trümmer → älteste → kleinste, Einfrieren nach 10 s Schlaf, Entfernen außerhalb
```

Werkzeuge greifen nur über `ToolContext` auf Physik, Welt und Kamera zu. Die Werkzeugleiste und das Parameter-Panel
entstehen aus `store.tools` (aus der Registry). Fahrzeuge: `physics/vehicle.ts` (Rapier-Raycast-Fahrzeug),
`tools/driving.ts` (Ein-/Aussteigen, Verfolgerkamera). Im Bodenmodus wandert eine leere Blase mit der Kamera,
`GroundService.extraRaycast` lässt die Kamera auf Dächern, Kisten und Mauern stehen.

## Zerstörbarkeit (M4)

Sichtbare Welt = gestreamte Tiles. Zerstörbare Welt = OSM-Gebäude-Proxies in der Blase.

- **Explosion** (`tools/explosions.ts`): `ExplosionService.detonate(posBubble, tnt)` → `Destruction.applyBlast`,
  Impulse auf Körper (`physics/blast.ts`), Krater, `vfx/effects.ts`, `audio/audio.ts`, Wackeln, Ereignis.
  Werkzeuge erreichen ihn über `ToolContext.explosions`; Zünder und fallende Bomben laufen als `addTask`
  im festen Schritt.
- **Zerstörung** (`physics/destruction.ts`, `physics/fracture.ts`): Beim ersten starken Treffer wird das Gebäude
  vorab in Stockwerke (3,2 m) und Zellen gebrochen; Gebäude-Collider entfällt, Dreiecke im Zellen-Mesh werden
  entartet (`hideBuilding`). Die Stücke sind feste Rapier-Körper (`fragment`, angeheftet). Überdruck oder Treffer
  lösen sie, der Strukturtest lässt ungestützte Stücke nach 0,18 s fallen (Stockwerk für Stockwerk). Löst eine
  Explosion kein Stück, wird der Bruch zurückgenommen.
- **Maske** (`world/tileMask.ts`): bis 32 Kreise/Polygone in einem ENU-Anker, Polygone in einer Data-Texture.
  Jedes geladene Tile-Modell wird über `ProviderContext.onTileModel` (Event `load-model`, nach den Plugins)
  per `onBeforeCompile` erweitert. Krater maskieren in allen Modi ihre Schüssel; zerstörte Gebäude werden im
  Fotogrammetrie-Modus oberhalb des Sockels maskiert. `GroundService` und Picking ignorieren maskierte Treffer.
- **Krater** (`world/craters.ts`, `world/heightPatches.ts`): Höhen-Patch für `HeightSampler`, `GroundService` und
  das Heightfield, dazu ein eigenes Schüssel-Mesh mit Wall (ADR-022). Im Physik-Gelände liegt unter jedem
  Krater ein feines Heightfield (0,5 m), das grobe ist dort abgesenkt (`PhysicsWorld.terrainDetails`).
- **Effekte** laufen mit der simulierten Zeit (Pause, Zeitlupe). GPU-Partikel: Instanced-Quads, Bewegung im
  Vertex-Shader aus Startwerten und Alter, Ringpuffer ohne Allokation.

## Apokalypse (M6)

- **Effekt-Hülle** (`world/globeFx/overlay.ts`): ein Ellipsoid-Mesh im `globe`-Frame (ECEF), Shader mit bis zu
  8 Ereignissen. `GlobeEffects` (`world/globeFx/globeEffects.ts`) verwaltet Ereignisse (`add`), ENU-Anker für
  Pilzwolken und Asteroiden, Aufgaben (`addTask`, laufen mit `scaledDt`, auch ohne Physik), die Verdunkelung
  (`darken`, wirkt in `engine.ts` auf Himmel, Sonne und Dunst) und `farM` für die Mond-Sequenz.
- **Werkzeuge** mit `targetMode: 'globe' | 'both'` bekommen über `onGlobeTarget` einen Punkt auf dem Globus
  (Raycast auf die Kacheln, sonst Ellipsoid). Aktionen erhalten `ToolEnv.world` (`WorldApi`: Effekte,
  Globuskamera, Physik, Zerstörung, Ton, `resetWorld`).
- **Kamera-Skript:** `GlobeCamera.setScript(fn)` liefert pro Frame eine Pose; die Steuerung ist so lange aus.
- **Reset:** `ToolManager.resetWorld()` leert Effekte, Krater, Masken, Zerstörung, Schwerkraft und baut die
  Blase am selben Ort neu (`PhysicsWorld.resetBubble`).

## Spielschicht (S1, ADR-026)

`src/game/`: `CountryIndex` (Natural Earth, Punkt-in-Polygon über ein 2°-Suchgitter), `PoliticalMap` (im Globus-Frame: Länderflächen als Hülle mit ID-Textur und Farbtabelle, Landgrenzen als `LineSegments2` in 30°-Stücken relativ zur Stückmitte, Horizonttest im Shader statt Tiefentest), `GameLayer` (Laden beim ersten Einschalten, Klick → Strahl gegen das WGS84-Ellipsoid → Land, Hover, Beschriftungen ≈ 10 Hz in `store.countryLabels`). Die Engine ruft `game.update(dt, Kamerahöhe)` nach den Werkzeugen.

## Laden und Bundle

- `main.ts` lädt nur das UI-Overlay (≈ 11 kB gzip) und rendert es sofort.
- `core/engine.ts` (three.js) ist ein eigener Chunk per `import()`.
- Rapier-WASM, schwere Werkzeuge (Stufe 4/5) und Wetter-/VFX-Module werden bei Bedarf nachgeladen.
- Budget: initialer JS-Bundle < 1,5 MB gzip.

## Netzwerk-Regeln

Jeder Netzwerkaufruf: Timeout, Retry mit exponentiellem Backoff, verständliche Fehlermeldung (Toast), nie Absturz.
Overpass: max. 1 parallele Anfrage, Speicher-LRU + IndexedDB (TTL 7 Tage), Schlüssel = Geohash P6, Umkreis der Bildmitte (ADR-019).
Nominatim: max. 1 req/s. Google-Tiles: kein persistentes Caching. Keys werden nie geloggt.

## Tests

- Unit (Vitest, Node): reine Module (`core/*`, später `geo`, `blast`, Krater, Terrarium, Overpass-Parser, Provider-Kette mit gemocktem `fetch`, Serialisierung).
- E2E (Playwright, Chromium mit SwiftShader): Smoke-Test; alle nicht-lokalen Requests werden abgefangen.
- Kein Test spricht echte externe APIs an. Die Erreichbarkeit der APIs prüft separat `scripts/check-endpoints.sh`.
