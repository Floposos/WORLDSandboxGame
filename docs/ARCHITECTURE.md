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

**Floating Origin:** Entfernt sich die Kamera > `ORIGIN_SHIFT_THRESHOLD_M` (5 km × `WORLD_SCALE`) vom Ursprung,
wird O neu gesetzt: Tiles-Gruppe neu transformieren, alle lokalen Objekte und Rapier-Bodies um `deltaLocal` verschieben,
Kamera mitverschieben, dann `originShifted { newOriginEcef, deltaLocal }` emittieren. Bei großem Richtungswechsel
(Globus-Ansicht, andere Stadt) ändert sich auch die Rotation; dann werden die lokalen Inhalte (Blase) neu aufgebaut statt verschoben.

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
          overlay: XYZTilesOverlay(EOX Sentinel-2 2016 | GIBS Blue Marble, per Probe-Kachel gewählt, ADR-012)
        errorTarget = Preset × 1/20 (ADR-014)
        M2: + OSM-Gebäude als extrudierte Proxies (Overpass, nur Spielblase)
```

Ohne Key wird ein Provider still übersprungen. Alle Provider hängen ihre `tiles.group` in die Gruppe `globe`
(ECEF, um −90° um X gedreht, damit „oben“ am Nordpol +Y ist). `GlobeCamera` (`src/camera/globeCamera.ts`) kapselt
`GlobeControls` und den „Fliege zu“-Flug (`flyTo.ts`: Steigen, Reisen auf dem Großkreis, Sinken; smootherstep).

Auch nach dem Start kann ein Provider ausfallen (Quota, 429 beim Tile-Laden). Dann wechselt die Kette zur Laufzeit,
emittiert `providerChanged` und zeigt einen Toast. Der Nutzer kann den Provider manuell festlegen (`settings.provider`).

## Zerstörbarkeit (M4)

Sichtbare Welt = gestreamte Tiles. Zerstörbare Welt = OSM-Gebäude-Proxies in der Blase. Im Fotogrammetrie-Modus
blendet eine Shader-Maske (bis 32 Kreise/Polygone in ENU, Uniform-Array oder Data-Texture) das Tile-Mesh dort aus,
wo Proxies stehen. Krater = Height-Patches, die im Gelände-Shader (Open-Data) bzw. als maskiertes Zusatz-Mesh wirken
und vom `heightSampler` sowie dem Heightfield-Collider berücksichtigt werden. Details: Auftrag 7.2–7.4.

## Laden und Bundle

- `main.ts` lädt nur das UI-Overlay (≈ 11 kB gzip) und rendert es sofort.
- `core/engine.ts` (three.js) ist ein eigener Chunk per `import()`.
- Rapier-WASM, schwere Werkzeuge (Stufe 4/5) und Wetter-/VFX-Module werden bei Bedarf nachgeladen.
- Budget: initialer JS-Bundle < 1,5 MB gzip.

## Netzwerk-Regeln

Jeder Netzwerkaufruf: Timeout, Retry mit exponentiellem Backoff, verständliche Fehlermeldung (Toast), nie Absturz.
Overpass: max. 1 parallele Anfrage, Speicher-LRU + IndexedDB (TTL 7 Tage), Schlüssel = Geohash P6, nur Spielblase.
Nominatim: max. 1 req/s. Google-Tiles: kein persistentes Caching. Keys werden nie geloggt.

## Tests

- Unit (Vitest, Node): reine Module (`core/*`, später `geo`, `blast`, Krater, Terrarium, Overpass-Parser, Provider-Kette mit gemocktem `fetch`, Serialisierung).
- E2E (Playwright, Chromium mit SwiftShader): Smoke-Test; alle nicht-lokalen Requests werden abgefangen.
- Kein Test spricht echte externe APIs an. Die Erreichbarkeit der APIs prüft separat `scripts/check-endpoints.sh`.
