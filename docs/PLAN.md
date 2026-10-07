# GlobeBox – Plan

Stand: 2026-10-04 · Aktueller Meilenstein: **M3 abgeschlossen** (wartet auf unabhängigen Test). M2 unabhängig getestet und bestanden.

Verbindliche Spezifikation ist der Projektauftrag (Abschnitte 0–15). Dieses Dokument hält fest,
wie er umgesetzt wird, was erledigt ist, welche Annahmen gelten und welche Risiken offen sind.
Architektur-Details stehen in [ARCHITECTURE.md](ARCHITECTURE.md), Entscheidungen in [DECISIONS.md](DECISIONS.md).

## Meilensteine

### M0 – Projektgerüst ✅

- [x] Vite 8 + TypeScript 6 (strict, `noUncheckedIndexedAccess`), ESLint 10 (typescript-eslint, type-checked), Prettier
- [x] Vitest (Unit), Playwright (Smoke-E2E, externe Requests werden blockiert)
- [x] Ordnerstruktur aus 4.1 (leere Module mit `.gitkeep`)
- [x] Kern: `constants.ts` (WGS84, `WORLD_SCALE`), typisierter `EventBus`, fester Physik-Schritt mit Akkumulator (60 Hz, max. 5 Substeps, Zeitskala), seedbarer PRNG, Settings mit sicherem `localStorage`, Store (Signals)
- [x] UI-Overlay (Preact): FPS-/Stats-Anzeige, Attributionsleiste, Toasts, globaler Fehler-Toast, i18n `de.ts`/`en.ts`
- [x] Leere Szene (Sternenhimmel), three.js als Lazy-Chunk
- [x] `README.md` (Rohfassung), `LICENSE` (MIT), `.env.example`, `.gitignore`, `ATTRIBUTIONS.md` (Rohfassung)
- [x] CI: install → typecheck → lint → test → build, danach E2E
- [x] Deploy: Build → GitHub Pages (`configure-pages`, `upload-pages-artifact`, `deploy-pages`), `base` = `/WORLDSandboxGame/`
- [x] Endpunkt-Prüfung als Skript + wöchentlicher Workflow
- [x] Abnahme: `npm run dev` zeigt leere Szene mit FPS-Anzeige (Screenshot), typecheck/lint/test/build grün, `docs/PLAN.md` existiert
- [x] CI grün auf GitHub (PR #1: check + e2e)

### M1 – Globus ✅

- [x] `geo.ts` (WGS84 ↔ ECEF ↔ ENU, Haversine, Großkreis) + 24 Tests (Äquator, Pole, Datumsgrenze, Everest, Marianengraben; < 1 mm)
- [x] Open-Data-Provider: `TerrariumMeshPlugin` (AWS Terrarium) mit `XYZTilesOverlay` (EOX Sentinel-2 2025 seit ADR-025, 2016 wählbar, Ersatz GIBS Blue Marble, ADR-010/012)
- [x] `GlobeControls` (Grab-the-Earth, Neigen, Zoom zum Cursor, Trägheit, Geländekollision)
- [x] Ortssuche (Photon, Fallback Nominatim mit 1 Anfrage/s, Debounce 400 ms, Cache, Strg+K und /) + „Fliege zu“ (Steigen/Reisen/Sinken, 1,5–8 s)
- [x] HUD: Ortsname (Reverse-Geocoding nach 1,5 s Stillstand), Koordinaten, Höhe, Höhe über Grund, Quelle
- [x] Attributionsleiste dynamisch aus `TileProvider.attributions()` + Suche, Logos immer sichtbar
- [x] Atmosphären-Fresnel, Sonne nach Datum/Uhrzeit (NOAA), Zeitregler mit „Jetzt“, Sterne blenden in Bodennähe aus
- [x] Google- und Cesium-Provider, Einstellungsdialog mit Keys, `providerChain` mit Fallback + Toast (13 Tests mit Fakes)
- [x] E2E: Start mit Open Data und Flug zur Zugspitze, Kacheln und Geocoder aus Fixtures
- [x] Abnahme ohne Key: Flug zur Zugspitze, Relief erkennbar (Screenshot mit echtem Gelände, Bild in der Sandbox gemockt)
- [ ] Abnahme mit Google-Key (New York in 3D) und ungültigem Key: braucht echten Key, Prüfung durch Florian bzw. Test-Thread

### M2 – Bodenkontakt ✅

- [x] Floating Origin (`core/floatingOrigin.ts`): Welt = lokaler ENU-Frame, Gruppe `globe` trägt ECEF → lokal, Spielobjekte in `local`; Verschiebung ab 5 km (in der Höhe ab 2 × Höhe), im Globusmodus nur ohne Geste/Trägheit (ADR-016)
- [x] Raycast über alle Tilesets (`WorldHit` mit lat/lon/h + Normale), `GroundService` „Boden unter Punkt“ (Mesh → Provider-Höhe → `heightSampler`, ADR-015)
- [x] `heightSampler` mit LRU-Cache (Terrarium z14)
- [x] Flug-, Boden- und Verfolgerkamera, `CameraRig` mit Tasten 1–4 und Modusleiste; Suche aus Flug-/Bodenmodus kehrt nach dem Flug in den Modus zurück
- [x] Zielkreis-Vorschau (Radius = Simulationsblase des Presets), auf das Gelände drapiert, 10 Hz
- [x] Reversed-Z-Tiefenpuffer, Near/Far außerhalb des Globusmodus selbst gesetzt
- [x] Tests: Floating Origin, Orientierung, Gehen/Springen, Flugtempo, Clip-Ebenen, Zielkreis; E2E Bodenmodus 1,8 m über Grund und Gehen ohne Einsinken
- [x] Abnahme: Tokio und Buenos Aires am Boden (Kamera < 2 km vom Ursprung, Positionsstreuung im Stand 0 mm), Bodenkamera geht die Straße entlang ohne einzusinken, Wechsel Tokio → Buenos Aires per Suche (landet wieder im Bodenmodus)

### M3 – Physik & Bauen ✅

- [x] OSM-Gebäude über Overpass (Geohash-6-Zellen, Mirror-Liste, 1 Anfrage/s, Cache Speicher + IndexedDB), Höhenregeln aus Spec 5.4, Multipolygone, `building:part`, Farben aus Tags, prozedurales Fensterraster (ADR-019)
- [x] Open Data: Gebäude sichtbar; Google/Cesium: nur unsichtbare Collider
- [x] Rapier per Lazy Load, Simulationsblase mit eigenem Tangential-Frame, Heightfield 128 × 128, statische Trimesh-Collider je Gebäude (ADR-020)
- [x] Body-Budget (Trümmer → älteste → kleinste, Ausblenden), Einfrieren nach 10 s Schlaf, Auftauen bei Treffern, Despawn außerhalb der Blase
- [x] Werkzeuge Stufe 0 (`place-box`, `place-ball`, `place-car`, `place-npcs`, `place-wall`, `eraser`) und Stufe 2 (`throw`, `wrecking-ball`, `force-push`, `magnet`), Werkzeugleiste und Parameter-Panel aus der Registry
- [x] Auto mit Rapier-Raycast-Fahrzeug, fahrbar (W/A/S/D, Leertaste bremst, F ein/aus), Verfolgerkamera
- [x] Bodenkamera stößt an Gebäude und Objekte der Blase (ADR-021); M2-Testbefunde behoben, Pause/Zeitlupe (ADR-018)
- [x] Abnahme: 200 Kisten fallen auf ein Hausdach in Berlin-Mitte (echte OSM-Daten) und schlafen nach kurzer Zeit alle; Physikschritt 0,2 ms. FPS in der Sandbox nur Software-Rendering (4 FPS), Messung „Mittel > 50 FPS“ auf echter GPU steht aus. Auto fährt (54 km/h nach 9 s, lenkt).

### M4 – Explosionen & Zerstörung

- [x] Druckwelle nach Kinney-Graham (`physics/blast.ts`), Impulse auf Körper, Bildschirmwackeln
- [x] Zerstörungs-Pipeline: Vorab-Bruch in Stockwerke und Zellen, feste Bruchstücke, Lösen durch Überdruck oder Treffer, Strukturtest, Status intakt/beschädigt/eingestürzt, Abschirmung durch Nachbargebäude (ADR-022)
- [x] Maskierung des Tile-Meshes (Kreise und Grundrisse, `onBeforeCompile` nach den Plugins), zerstörte Gebäude im Fotogrammetrie-Modus
- [x] Krater: Höhen-Patches für Sampler, Boden und Heightfield, Krater-Mesh mit Wall (ADR-022)
- [x] GPU-Partikel und Effekte: Blitz, Feuerball, Funken, Trümmer, Rauchwolke, Rauchsäule (20–60 s), Schockwellen-Ring, Staub beim Einsturz, Feuer an eingestürzten Gebäuden
- [x] Prozeduraler Ton (Explosion mit Schallverzögerung, Rumpeln), Lautstärke und Ton aus in den Einstellungen
- [x] Werkzeuge Stufe 3: `grenade`, `aerial-bomb` (Verfolgerkamera), `demolition-charge` (X zündet), `rocket`
- [x] HUD: Objekte, Partikel, zerstörte Gebäude; Bilanz-Toast nach dem Einschlag (TNT, MJ, Krater, Gebäude)
- [x] Abnahme Hamburg (echte OSM-Daten, Open Data): 500-kg-Bombe auf ein Haus am Rathausmarkt → Krater 9,5 m, 2 Gebäude eingestürzt (Stockwerke fallen nach), Trümmer fliegen, Rauchsäule steht. Google-Modus und „Mittel ≥ 30 FPS“ brauchen Key bzw. echte GPU (offen).

### M5 – Natur & Katastrophen

- [x] Wetter: Zustand im Store, Voreinstellungen klar/bewölkt/Regen/Schnee/Gewitter/Nebel, Wind (Stärke und Herkunftsrichtung), Echtwetter von Open-Meteo mit 15-Minuten-Cache (ADR-023)
- [x] Wetter-Darstellung: Wolkendecke (fBm-Shader, windgetrieben), Regen und Schnee als GPU-Partikelvolumen um die Kamera, Nebel nach Sichtweite, Blitze mit Donner, gedämpftes Sonnenlicht und grauer Himmel
- [x] Wasser: Wellen-Shader (prozedurale Normalmap, Fresnel, Sonnenglanz), Flut in der Blase mit Auftrieb und Wasserwiderstand
- [x] Werkzeuge Stufe 1: `time-of-day`, `weather` (Knopf „Echtes Wetter übernehmen“), `flood`, `gravity` – wirken sofort beim Verstellen der Regler
- [x] Werkzeuge Stufe 4: `meteor` (E = ½·m·v² → TNT, Krater nach Collins et al., Leuchtspur, Verfolgerkamera), `tornado` (Rankine-Wirbel, wandert, reißt Dächer ab), `earthquake` (Bodenbeschleunigung, schwache Gebäude zuerst), `volcano` (wachsender Kegel als Höhen-Patch, Lava, Aschesäule), `tsunami` (Wellen-Mesh und Kraftfeld)
- [x] Zerstörung um eigene Schadensregeln erweitert (`damage`, `vaporize`), Knöpfe im Parameter-Panel, Werkzeugleiste zweireihig
- [x] Abnahme: Tornado EF3 durch die Hamburger Altstadt reißt Bruchstücke heraus (31 beschädigt, 51 eingestürzt, rund 1 000 lose Trümmer). Meteor 50 m bei 20 km/s: 9,4 Mt TNT, Krater 1 372 m (Barringer-Größenordnung). „Echtes Wetter“ in London übernimmt die Open-Meteo-Antwort (klar bzw. Regen).

### M6 – Apokalypse

- [x] Effekt-Hülle um den Globus (`world/globeFx/`): Ellipsoid 10 km über dem WGS84, Shader mit bis zu 8 Ereignissen (Wirkungsringe, Druckwelle, Krater, Glut, Staubschleier, Lichtblitz), Linien mindestens 1,5 px breit, blendet ab 30 km Kamerahöhe ein (ADR-024)
- [x] Pilzwolke (Stiel, Hut, Kondensationsring, Fuß) mit Noise-Shader, steigt in 22 s auf; Bodenringe in Bodennähe
- [x] Werkzeuge Stufe 5: `mega-bomb` (1 kt–50 Mt, logarithmischer Regler, Luft- oder Bodendetonation, Ringe abschaltbar; in der Blase echte Druckwelle), `asteroid` (1–50 km, aus der Globusansicht gezielt, Krater nach Collins, Verdunkelung von Himmel, Sonne und Sicht), `moon-drop` (filmische Sequenz mit Zeitraffer, Kamerafahrt, Zerreißen an der Roche-Grenze, Reset-Angebot)
- [x] Hinweis-Dialog beim ersten Einsatz der Stufe 5 („Rein fiktive, stilisierte Darstellung“), gespeichert in den Einstellungen
- [x] „Welt zurücksetzen“ (Knopf neben dem Zahnrad und am Ende der Mond-Sequenz): entfernt Effekte, Krater, Trümmer, Verdunkelung; Gebäude und Blase werden neu aufgebaut
- [x] Abnahme: 50-Mt-Bombe über Hamburg aus 1 500 und 7 000 km als Ring mit Glutkern sichtbar, 100 kt in der Altstadt mit Pilzwolke (aus 25 km sichtbar, 188 Gebäude eingestürzt). Mond-Absturz läuft vollständig ohne Konsolenfehler, „Welt zurücksetzen“ stellt den Ausgangszustand her. Asteroid 10 km: 75 Tt TNT, Krater 119 km, Erde verdunkelt.

### M7 – Komfort · M8 – Release

Umfang und Abnahme wie im Auftrag, Abschnitt 9. Werden beim Start des jeweiligen Meilensteins hier detailliert.

## Prüfung der Bibliotheken (2026-10-04)

Gelesen in `node_modules/<pkg>` (README, Typdefinitionen, API.md) und im GitHub-README.

| Paket                       | Version (gepinnt) | Erkenntnisse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `three`                     | 0.186.1           | `WebGLRenderer` bleibt Standard; `three/webgpu` existiert, wird nicht genutzt (3d-tiles-renderer-Plugins und `onBeforeCompile`-Maskierung setzen auf WebGL-Materialien).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `3d-tiles-renderer`         | 0.5.3             | Einstiegspunkte `3d-tiles-renderer/three` (`TilesRenderer`, `GlobeControls`, `EnvironmentControls`, `CameraTransitionManager`, `Ellipsoid`, `GeoUtils`) und `3d-tiles-renderer/plugins`. Plugins: `GoogleCloudAuthPlugin`, `CesiumIonAuthPlugin`, `QuantizedMeshPlugin`, `ImageOverlayPlugin` + `XYZTilesOverlay`/`WMTSTilesOverlay`/`TMSTilesOverlay`, `TilesFadePlugin`, `UpdateOnChangePlugin`, `TileFlatteningPlugin`, `LoadRegionPlugin`, `ReorientationPlugin`. **Neu und wichtig:** `TerrariumMeshPlugin` (dekodiert genau unsere AWS-Terrarium-Kacheln zu Gelände mit Skirts) – ist exportiert, hat aber noch keine `.d.ts`; wir brauchen in M1 eine eigene Typdeklaration. `LRUCache`-Grenzen sind harte Obergrenzen (Gotcha aus der README). Peer: `three >= 0.167`. |
| `@dimforge/rapier3d-compat` | 0.21.0            | WASM als Base64 im JS (bundlerfreundlich, ca. 1 MB+ ⇒ zwingend Lazy Load). `await RAPIER.init()` ohne Argumente. **Nicht** plattformübergreifend deterministisch; dafür gibt es `@dimforge/rapier3d-deterministic-compat` (ebenfalls 0.21.0) – relevant für geteilte Replays in M7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Prüfung der Endpunkte (2026-10-04)

Die Arbeitsumgebung blockiert die meisten Datenhosts per Egress-Policy. Geprüft wurde deshalb mit
`scripts/check-endpoints.sh` (curl) von einem GitHub-Runner aus (Workflow „Endpoint check“, Lauf vom 2026-10-04),
ergänzt um `curl` aus der Arbeitsumgebung und die EOX-Capabilities.

| Endpunkt                                                                        | Ergebnis                                    | Anmerkung                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS Terrarium `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | ✅ 200 `image/png`                          | auch aus der Sandbox erreichbar                                                                                                                                                                                                           |
| EOX WMTS Capabilities                                                           | ✅ 200 `application/xml`                    | Layer `s2cloudless_3857` (2016) und `s2cloudless-2017_3857` … `s2cloudless-2025_3857`, TileMatrixSet `g` / `GoogleMapsCompatible`. Template: `https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg`                     |
| EOX Kachel 2016 und 2024                                                        | ✅ 200 `image/jpeg`                         |                                                                                                                                                                                                                                           |
| EOX Lizenz                                                                      | ⚠️ teilweise                                | Aktuelle Lizenzseite nennt für EOxCloudless CC BY-NC-SA 4.0 (nicht-kommerziell) und einen einheitlichen Attributionstext. Dass der Jahrgang 2016 CC BY 4.0 ist, stand nicht auf der abgerufenen Seite ⇒ vor M1-Aktivierung erneut prüfen. |
| NASA GIBS Blue Marble `BlueMarble_ShadedRelief_Bathymetry` (3857, Level 8)      | ✅ 200 `image/jpeg`                         |                                                                                                                                                                                                                                           |
| NASA GIBS Black Marble `VIIRS_Black_Marble` (3857)                              | ✅ 200 `image/png`                          | für Stadtlichter                                                                                                                                                                                                                          |
| Overpass `overpass-api.de`                                                      | ✅ 200                                      |                                                                                                                                                                                                                                           |
| Overpass-Mirror `overpass.private.coffee`                                       | ❌ Timeout                                  | Mirror-Liste: `overpass.kumi.systems` wird im nächsten Lauf geprüft                                                                                                                                                                       |
| Photon `/api` und `/reverse`                                                    | ✅ 200 JSON                                 |                                                                                                                                                                                                                                           |
| Nominatim `/search`                                                             | ✅ 200 JSON                                 |                                                                                                                                                                                                                                           |
| Open-Meteo `/v1/forecast?current=…`                                             | ✅ 200 JSON                                 |                                                                                                                                                                                                                                           |
| Google `tile.googleapis.com/v1/3dtiles/root.json`                               | ✅ ungültiger Key ⇒ **400** (nicht 401/403) | Fallback-Kette muss 400 als „Key ungültig“ werten                                                                                                                                                                                         |
| Cesium ion `api.cesium.com` ohne Token                                          | ✅ 401                                      |                                                                                                                                                                                                                                           |

## Annahmen

- Repository-Name bleibt `WORLDSandboxGame` ⇒ Pages-URL `https://floposos.github.io/WORLDSandboxGame/`.
- Node 22 LTS (`.nvmrc`) lokal und in CI.
- Achsen: lokaler ENU-Frame in three.js mit **x = Ost, y = Oben, z = −Nord** (rechtshändig, Y-up). Details in ARCHITECTURE.md.
- `WORLD_SCALE = 1` (1:1). Skalierung erst, wenn Messungen es verlangen.
- Das Projekt ist nicht-kommerziell; damit sind NC-lizenzierte Quellen (EOX ab 2017, Open-Meteo, Cesium Community) zulässig, solange die Attribution stimmt.
- Englisch ist nur per `?lang=en` erreichbar, bis M7 eine Sprachwahl bringt.

## Risiken

| Risiko                                                                                                                               | Auswirkung                                                                                        | Gegenmaßnahme                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Egress-Sperre der Arbeitsumgebung (EOX, GIBS, Overpass, Photon, Open-Meteo, Cesium blockiert; vom GitHub-Runner aus alle erreichbar) | Sichtprüfung von M1+ mit echten Daten ist in der Sandbox nicht möglich (nur Gelände von AWS lädt) | Netzwerkfreigabe in den Projekt-Einstellungen, oder Sichtprüfung über die Pages-Vorschau; Tests nutzen ohnehin Fixtures/Route-Mocking |
| `typescript` 7 (nativer Compiler) ist `latest`, typescript-eslint unterstützt nur `<6.1`                                             | Lint bricht                                                                                       | TS 6.0.3 gepinnt (ADR-001); Upgrade, sobald typescript-eslint TS 7 unterstützt                                                        |
| `TerrariumMeshPlugin` ohne Typen und erst seit kurzem im Paket                                                                       | API kann sich ändern                                                                              | Version gepinnt, eigene `.d.ts`, dünner Adapter in `OpenDataProvider`                                                                 |
| Floating Origin vs. `GlobeControls` (arbeitet im Ellipsoid-Frame)                                                                    | Jittern am Boden, Steuerung bricht                                                                | `GlobeControls.setEllipsoid(ellipsoid, tilesGroup)` mit transformierter Tiles-Gruppe; früh in M2 prototypen                           |
| Rapier nicht plattformübergreifend deterministisch                                                                                   | Geteilte Szenen (M7) laufen auf anderem Rechner leicht anders                                     | Aktionen + Seed teilen („sichtbar gleich“ reicht laut Abnahme); optional `rapier3d-deterministic-compat`                              |
| EOX-Lizenzlage je Jahrgang unklar                                                                                                    | Falsche Attribution                                                                               | Standard 2016 (CC BY), Lizenz vor Aktivierung erneut prüfen                                                                           |
| Fotogrammetrie-Maskierung (M4) per `onBeforeCompile` in Plugin-Materialien                                                           | Shader-Injection kollidiert mit Overlay-Materialien                                               | In M4 früh mit Google-Tiles prototypen                                                                                                |
| Performance-Budget 60 FPS auf iGPU                                                                                                   |                                                                                                   | Messen mit Stats-Panel, Presets koppeln, Instancing/Pools ab M3                                                                       |
| Playwright-Browser-Version in Sandbox ≠ gepinnte Version                                                                             | Lokale E2E brauchen `PW_CHROMIUM_PATH`                                                            | In CI wird der passende Chromium installiert                                                                                          |

## Erkenntnisse aus M0

- Initialer Bundle: 11 kB gzip (UI) + 132 kB gzip (three.js-Engine-Chunk). Budget 1,5 MB gzip ist weit entfernt.
- Headless-Chromium mit SwiftShader läuft mit ~50 FPS bei leerer Szene; für FPS-Abnahmen später echte Hardware messen.
