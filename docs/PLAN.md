# GlobeBox – Plan

Stand: 2026-10-04 · Aktueller Meilenstein: **M1 abgeschlossen**, M2 wartet auf Freigabe.

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
- [x] Open-Data-Provider: `TerrariumMeshPlugin` (AWS Terrarium) mit `XYZTilesOverlay` (EOX Sentinel-2 2016, Ersatz GIBS Blue Marble, ADR-010/012)
- [x] `GlobeControls` (Grab-the-Earth, Neigen, Zoom zum Cursor, Trägheit, Geländekollision)
- [x] Ortssuche (Photon, Fallback Nominatim mit 1 Anfrage/s, Debounce 400 ms, Cache, Strg+K und /) + „Fliege zu“ (Steigen/Reisen/Sinken, 1,5–8 s)
- [x] HUD: Ortsname (Reverse-Geocoding nach 1,5 s Stillstand), Koordinaten, Höhe, Höhe über Grund, Quelle
- [x] Attributionsleiste dynamisch aus `TileProvider.attributions()` + Suche, Logos immer sichtbar
- [x] Atmosphären-Fresnel, Sonne nach Datum/Uhrzeit (NOAA), Zeitregler mit „Jetzt“, Sterne blenden in Bodennähe aus
- [x] Google- und Cesium-Provider, Einstellungsdialog mit Keys, `providerChain` mit Fallback + Toast (13 Tests mit Fakes)
- [x] E2E: Start mit Open Data und Flug zur Zugspitze, Kacheln und Geocoder aus Fixtures
- [x] Abnahme ohne Key: Flug zur Zugspitze, Relief erkennbar (Screenshot mit echtem Gelände, Bild in der Sandbox gemockt)
- [ ] Abnahme mit Google-Key (New York in 3D) und ungültigem Key: braucht echten Key, Prüfung durch Florian bzw. Test-Thread

### M2 – Bodenkontakt · M3 – Physik & Bauen · M4 – Explosionen & Zerstörung · M5 – Natur & Katastrophen · M6 – Apokalypse · M7 – Komfort · M8 – Release

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
