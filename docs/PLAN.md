# GlobeBox – Plan

Stand: 2026-10-04 · Aktueller Meilenstein: **M0 abgeschlossen**, M1 wartet auf Freigabe.

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
- [ ] CI grün auf GitHub (siehe PR)

### M1 – Globus

- [ ] `geo.ts` (WGS84 ↔ ECEF ↔ ENU) + Roundtrip-Tests (Äquator, Pole, Datumsgrenze, Everest, Marianengraben; 1 mm)
- [ ] Open-Data-Provider: `TilesRenderer` + `TerrariumMeshPlugin` (AWS Terrarium) + `ImageOverlayPlugin` mit `XYZTilesOverlay` (EOX Sentinel-2 2016) bzw. GIBS Blue Marble für niedrige Zoomstufen
- [ ] `GlobeControls` aus 3d-tiles-renderer konfigurieren (Grab-the-Earth, Neigen, Zoom zum Cursor, Trägheit, Geländekollision)
- [ ] Ortssuche (Photon, Fallback Nominatim, Debounce 400 ms, Ratelimit) + „Fliege zu“ (Steigen/Reisen/Sinken)
- [ ] Attributionsleiste dynamisch aus `TileProvider.attributions()`
- [ ] Atmosphären-Fresnel, Sonne nach Datum/Uhrzeit (NOAA)
- [ ] Google- und Cesium-Provider, Key-Dialog, `providerChain` mit Fallback + Toast (inkl. Tests mit gemocktem fetch)
- [ ] Abnahme laut Auftrag

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

Diese Arbeitsumgebung hat eine Egress-Sperre, die die meisten Datenhosts blockiert. Geprüft wurde deshalb
zweigleisig: `curl` aus der Umgebung und, wo gesperrt, Abruf über einen externen Fetcher. Zusätzlich prüft
`scripts/check-endpoints.sh` alle Endpunkte von einem GitHub-Runner aus (Workflow „Endpoint check“).

| Endpunkt                                                                        | Ergebnis                                                | Anmerkung                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS Terrarium `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | ✅ 200 `image/png` (z0 und z10)                         |                                                                                                                                                                                                                                                             |
| EOX WMTS Capabilities `tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml`       | ✅ extern abgerufen                                     | Layer `s2cloudless_3857` (2016) und `s2cloudless-2017_3857` … `s2cloudless-2025_3857`, TileMatrixSet `g` / `GoogleMapsCompatible`. Template: `/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg`                                                                |
| EOX Lizenz                                                                      | ⚠️ teilweise                                            | Aktuelle Lizenzseite nennt für EOxCloudless CC BY-NC-SA 4.0 (nicht-kommerziell) und einen einheitlichen Attributionstext. Dass der Jahrgang 2016 CC BY 4.0 ist, ist bekannt, stand aber nicht auf der abgerufenen Seite ⇒ vor M1-Aktivierung erneut prüfen. |
| NASA GIBS Blue Marble (WMTS 3857)                                               | ❓ hier gesperrt                                        | Runner-Check entscheidet; Layer-Name ggf. an Capabilities anpassen                                                                                                                                                                                          |
| Overpass `overpass-api.de/api/interpreter` + Mirror                             | ❓ hier gesperrt, extern robots-gesperrt                | Runner-Check                                                                                                                                                                                                                                                |
| Photon `/api`, `/reverse`                                                       | ❓ hier gesperrt, extern robots-gesperrt                | Runner-Check                                                                                                                                                                                                                                                |
| Nominatim `/search`                                                             | ❓ hier gesperrt, extern robots-gesperrt                | Runner-Check                                                                                                                                                                                                                                                |
| Open-Meteo `/v1/forecast?current=…`                                             | ❓ hier gesperrt, extern robots-gesperrt                | Runner-Check                                                                                                                                                                                                                                                |
| Google `tile.googleapis.com/v1/3dtiles/root.json`                               | ✅ erreichbar, ungültiger Key ⇒ **400** (nicht 401/403) | Fallback-Kette muss 400 als „Key ungültig“ werten                                                                                                                                                                                                           |
| Cesium ion `api.cesium.com`                                                     | ❓ hier gesperrt                                        | ohne Token wird 401 erwartet                                                                                                                                                                                                                                |

## Annahmen

- Repository-Name bleibt `WORLDSandboxGame` ⇒ Pages-URL `https://floposos.github.io/WORLDSandboxGame/`.
- Node 22 LTS (`.nvmrc`) lokal und in CI.
- Achsen: lokaler ENU-Frame in three.js mit **x = Ost, y = Oben, z = −Nord** (rechtshändig, Y-up). Details in ARCHITECTURE.md.
- `WORLD_SCALE = 1` (1:1). Skalierung erst, wenn Messungen es verlangen.
- Das Projekt ist nicht-kommerziell; damit sind NC-lizenzierte Quellen (EOX ab 2017, Open-Meteo, Cesium Community) zulässig, solange die Attribution stimmt.
- Englisch ist nur per `?lang=en` erreichbar, bis M7 eine Sprachwahl bringt.

## Risiken

| Risiko                                                                                        | Auswirkung                                                                              | Gegenmaßnahme                                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Egress-Sperre der Arbeitsumgebung (EOX, GIBS, Overpass, Photon, Open-Meteo, Cesium blockiert) | Sichtprüfung von M1+ mit echten Daten ist hier nicht möglich (nur Gelände von AWS lädt) | Netzwerkfreigabe in den Projekt-Einstellungen, oder Sichtprüfung über die Pages-Vorschau; Tests nutzen ohnehin Fixtures/Route-Mocking |
| `typescript` 7 (nativer Compiler) ist `latest`, typescript-eslint unterstützt nur `<6.1`      | Lint bricht                                                                             | TS 6.0.3 gepinnt (ADR-001); Upgrade, sobald typescript-eslint TS 7 unterstützt                                                        |
| `TerrariumMeshPlugin` ohne Typen und erst seit kurzem im Paket                                | API kann sich ändern                                                                    | Version gepinnt, eigene `.d.ts`, dünner Adapter in `OpenDataProvider`                                                                 |
| Floating Origin vs. `GlobeControls` (arbeitet im Ellipsoid-Frame)                             | Jittern am Boden, Steuerung bricht                                                      | `GlobeControls.setEllipsoid(ellipsoid, tilesGroup)` mit transformierter Tiles-Gruppe; früh in M2 prototypen                           |
| Rapier nicht plattformübergreifend deterministisch                                            | Geteilte Szenen (M7) laufen auf anderem Rechner leicht anders                           | Aktionen + Seed teilen („sichtbar gleich“ reicht laut Abnahme); optional `rapier3d-deterministic-compat`                              |
| EOX-Lizenzlage je Jahrgang unklar                                                             | Falsche Attribution                                                                     | Standard 2016 (CC BY), Lizenz vor Aktivierung erneut prüfen                                                                           |
| Fotogrammetrie-Maskierung (M4) per `onBeforeCompile` in Plugin-Materialien                    | Shader-Injection kollidiert mit Overlay-Materialien                                     | In M4 früh mit Google-Tiles prototypen                                                                                                |
| Performance-Budget 60 FPS auf iGPU                                                            |                                                                                         | Messen mit Stats-Panel, Presets koppeln, Instancing/Pools ab M3                                                                       |
| Playwright-Browser-Version in Sandbox ≠ gepinnte Version                                      | Lokale E2E brauchen `PW_CHROMIUM_PATH`                                                  | In CI wird der passende Chromium installiert                                                                                          |

## Erkenntnisse aus M0

- Initialer Bundle: 11 kB gzip (UI) + 132 kB gzip (three.js-Engine-Chunk). Budget 1,5 MB gzip ist weit entfernt.
- Headless-Chromium mit SwiftShader läuft mit ~50 FPS bei leerer Szene; für FPS-Abnahmen später echte Hardware messen.
