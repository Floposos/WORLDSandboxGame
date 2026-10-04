# Fortschrittsprotokoll

Laufendes Protokoll, neueste Einträge oben. Ergänzt die Häkchen in [PLAN.md](PLAN.md).
Verbindliche Spezifikation: [SPEC.md](SPEC.md).

## Aktueller Stand

- **Meilenstein:** M1 abgeschlossen (unabhängiger Test bestanden, Befund behoben). **M2 – Bodenkontakt begonnen.**
- **M2 erledigt:** `src/world/heightSampler.ts` (Terrarium z14, LRU 64 Kacheln, bilinear über Kachelgrenzen, Dedup, 5-s-Backoff, `sample`/`sampleAsync`/`prefetch`, 16 Tests), `LocalFrame.ecefToLocalMatrix()` in `geo.ts`, erweitertes `originShifted`-Event (`origin`, `newOriginEcef`, `deltaLocal`, `matrix` alt→neu lokal) in `events.ts`.
- **Nächster Schritt (in dieser Reihenfolge):** siehe „M2-Plan“ unten. Beginne mit `src/world/floatingOrigin.ts`.
- **Umgebung:** Neue Cloud-Umgebung mit Netzwerkfreigabe. `scripts/check-endpoints.sh` am 2026-10-04: alles erreichbar außer **Overpass** (overpass-api.de: Verbindungsabbruch, private.coffee: Proxy 403, kumi.systems: Timeout). Overpass wird erst ab M4 gebraucht; Florian kann die Hosts in der Umgebung freigeben. Sichtprüfung mit echten Daten: `node scripts/screenshot-live.mjs` (holt externe Anfragen über Node, weil Chromium über den Sandbox-Proxy ~4 s pro Anfrage braucht).

## M2-Plan (Entwurf, noch nicht umgesetzt)

1. `src/world/floatingOrigin.ts`: Gruppe `globe` bekommt `matrix = frame.ecefToLocalMatrix()` (`matrixAutoUpdate = false`), Weltkoordinaten = ENU des Ursprungs (x=Ost, y=Oben, z=−Nord). Neue Gruppe `local` für Spielobjekte. Verschieben, wenn Abstand Kamera–Ursprung > max(5 km, 2 × Kamerahöhe) (am Boden exakt 5 km laut Spec; im All sonst jedes Frame). Neuer Ursprung = Nadir der Kamera (h = 0). Delta D = M_neu · M_alt⁻¹ auf Kamera und alle Kinder von `local` anwenden, `originShifted` emittieren. Nur verschieben, wenn `GlobeControls.state === 0` (keine Geste); die Vektoren der Controls (`pivotPoint`, `zoomPoint`, `rotationInertiaPivot` als Punkte; `zoomDirection`, `dragInertia`, `up` als Richtungen) mit D transformieren. Hilfen: `worldToGeo`, `geoToWorld`, `enuAt(worldPos)`. ADR dazu schreiben.
2. Raycast: `TilesProviderBase.raycast` über alle Tilesets (Cesium-Gebäude sind Tileset 2), nächster Treffer. Dienst „Boden unter Punkt“: Raycast nach unten → `provider.sampleHeight` → `heightSampler.sample`. (Google/Cesium-Höhen sind ellipsoidisch, Terrarium orthometrisch: Geoid-Versatz bis ~±100 m, daher für Kameras immer zuerst Raycast aufs gerenderte Mesh.)
3. Kameras in `src/camera/`: `input.ts` (Tasten, Pointer-Lock, Drag-Fallback), `flyCamera.ts` (WASD+QE, Shift ×5, Tempo ∝ Höhe über Grund, min. 2 m über Grund), `groundCamera.ts` (Augenhöhe 1,8 m, Gehen 1,4 m/s, Shift 6 m/s, Sprung 4,5 m/s, g = 9,81; Hindernis blockiert, wenn Treffer > Füße + 0,6 m; SIMPLIFIED bis Rapier-Character-Controller in M3, ADR), `followCamera.ts` (folgt Object3D, kehrt 1,5 s nach Verschwinden zurück; Einstellung „automatisch folgen“; benutzt ab M4), `cameraRig.ts` (Modi globe/fly/ground/follow, Tasten 1–4, `store.cameraMode`, GlobeControls nur in globe aktiv). Leertaste: im Bodenmodus mit Pointer-Lock Sprung, sonst Pause.
4. Tiefenpuffer: `WebGLRenderer({ reversedDepthBuffer: true })` (three r186), Near/Far außerhalb des Globusmodus selbst setzen (near ≈ clamp(Höhe·0,01, 0,1, 100), far = Horizontdistanz wie `GlobeControls.adjustCamera`).
5. `src/world/targetPreview.ts`: Ring (Band, 64 Segmente) mit Radius = Blasenradius des Presets, Eckpunkte per Raycast von oben drapiert (10 Hz), `depthTest: false`, im Gruppenknoten `local`. Im Globus-/Flugmodus am Mauszeiger (< 50 km Höhe), im Bodenmodus in der Bildmitte.
6. UI: Modus-Leiste im HUD (1 Globus, 2 Flug, 3 Boden, 4 Verfolgen) + Steuerungshinweis; Texte in `de.ts`/`en.ts`.
7. Tests: Unit für floatingOrigin (Schwelle, D bildet alte auf neue lokale Koordinaten über ECEF ab), Boden-/Flug-Hilfsfunktionen, Rig-Moduswechsel. E2E: Tasten 2/3, im Bodenmodus HUD ≈ 1,8 m über Grund (flache Fixture), W gedrückt halten ohne Einsinken.
8. Abnahme: Tokio und Buenos Aires am Boden ohne Jittern (Screenshots, lokale Kamerakoordinaten < 5 km), Bodenkamera eine Straße entlang, Wechsel per Suche. Danach PLAN/PROGRESS, `feat(M2): …`, Testcheckliste.

- **Blocker:** keiner. Google- und Cesium-Pfad brauchen echte Keys zur Sichtprüfung.

## 2026-10-04 – M1 mit echten Daten geprüft (neue Umgebung)

**Erledigt**

- Zugspitze mit echten Sentinel-2-Bildern (EOX), echtem AWS-Gelände und echter Photon-Suche und -Rückwärtssuche im Browser geprüft.
- Behoben: Bei langsamem Netz konnte die Kamera beim Neigen unter das echte Gelände rutschen (nur grobe Kachel geladen). Kamera richtet sich jetzt zusätzlich nach der gemessenen Höhe, fehlgeschlagene Kacheln werden mit Backoff neu geladen (ADR-015).
- Behoben: Nach „Fliege zu“ lag das Ziel unter der Kamera statt in der Bildmitte. `arrivalPose` versetzt die Kamera bis 300 km Sichtweite schräg hinter das Ziel.
- Dev-Server stellt `globalThis.__globebox` für Prüfskripte bereit (nur `import.meta.env.DEV`).
- Der Problem-Eintrag „Arbeitsumgebung blockiert Datendienste“ aus M0 ist gelöst, bis auf Overpass.

## 2026-10-04 – M1 Globus

**Erledigt**

- `geo.ts` mit 24 Roundtrip-Tests (< 1 mm), `net.ts` (fetch mit Timeout, RateLimiter), Geocoder Photon/Nominatim mit Cache, NOAA-Sonnenstand. Routinemodule von einem Sonnet-Subagenten geschrieben, von mir geprüft.
- Provider: Open Data (Terrarium + EOX/GIBS), Google 3D Tiles, Cesium ion; `ProviderChain` mit Fallback-Toast und Laufzeit-Wechsel.
- `GlobeCamera` mit `GlobeControls` und „Fliege zu“, Atmosphäre, Sonnenlicht nach Zeit, Sterne.
- UI: Suche (Strg+K, /, Pfeiltasten), HUD mit Ortsname/Koordinaten/Höhe/Quelle, Zeitregler, Einstellungsdialog mit Keys.
- E2E mit Fixtures (flache Terrarium-Kachel, einfarbiges Bild, Photon-Antwort): Start mit Open Data, Flug zur Zugspitze.
- Sichtprüfung: echtes AWS-Gelände um die Zugspitze, Relief klar erkennbar. Bildkacheln in der Sandbox gemockt (EOX/GIBS blockiert).
- errorTarget-Faktor für Terrarium (ADR-014) nach Sichtprüfung: vorher war das Gelände zu grob.
- ADR-010 bis ADR-014.

**Offen**

- Google-Abnahme (New York in 3D, ungültiger Key ⇒ Toast) und Cesium mit echten Keys prüfen.

**Befunde aus dem unabhängigen M1-Test (behoben)**

- Mittel: Der Fallback-Toast nannte bei ungültigem Google-Key ohne Cesium-Token „Cesium ion aktiv“, obwohl Open Data übernahm. Die Kette meldet Ausfälle jetzt erst, wenn der tatsächlich aktive Provider feststeht (Test ergänzt).
- Niedrig: Umgebungslicht von 0,12 auf 0,3, damit die Nachtseite nicht schwarz wirkt. Draco-Decoder kommt aus dem three.js-Bundle statt von gstatic (in ATTRIBUTIONS.md).

**Probleme / bekannt kaputt**

- Fällt EOX erst während der Sitzung aus, scheitern neue Geländekacheln mit (Overlay-Fehler reißt die Kachel mit). Abfangen beim Start klappt (ADR-012).
- Atmosphäre ist ein einfacher Fresnel-Rand (`// SIMPLIFIED`); in Bodennähe ist der Himmel schwarz. Himmelsstreuung kommt mit M5 (Wetter).
- Vereinzelt feine helle Nähte zwischen Geländekacheln aus der Nähe.
- Software-Rendering in der Sandbox: 4–10 FPS in Bodennähe, aussagekräftig ist erst echte GPU.

## 2026-10-04 – M0 Projektgerüst

**Erledigt**

- Aktuelle Doku von `three` 0.186.1, `3d-tiles-renderer` 0.5.3 und `@dimforge/rapier3d-compat` 0.21.0 in den installierten Paketen gelesen, Versionen gepinnt. Fund: `TerrariumMeshPlugin` in 3d-tiles-renderer deckt das Open-Data-Gelände ab (ADR-003).
- Endpunkte aus Abschnitt 5 geprüft (Ergebnisse in PLAN.md). Prüfskript `scripts/check-endpoints.sh` + Workflow „Endpoint check“.
- Gerüst: Vite 8, TypeScript 6 strict, ESLint 10, Prettier, Vitest (22 Tests), Playwright-Smoketest.
- Leere Szene mit FPS-Anzeige, Game-Loop (60 Hz fest, Zeitskala), EventBus, PRNG, Settings, UI-Overlay (Preact), Fehler-Toast, i18n.
- CI-Workflow und GitHub-Pages-Deploy. PR #1 geöffnet, CI grün (check + e2e).
- Endpunkt-Check vom GitHub-Runner: alle Pflicht-Endpunkte erreichbar, nur Overpass-Mirror `private.coffee` mit Timeout.
- Doku: PLAN, ARCHITECTURE, DECISIONS (9 ADRs), TOOLS, README und ATTRIBUTIONS (Rohfassung).
- Florians Startauftrag als `docs/SPEC.md` abgelegt, `CLAUDE.md` verweist künftige Sessions auf PROGRESS → PLAN → SPEC.

**Offen**

- GitHub Pages in den Repo-Einstellungen auf „GitHub Actions“ stellen (Florian).
- M1 startet nach Florians „weiter“.

**Probleme**

- ~~Die Arbeitsumgebung blockiert EOX, NASA GIBS, Overpass, Photon, Nominatim, Open-Meteo und Cesium.~~ Gelöst mit der neuen Umgebung (2026-10-04), nur Overpass noch blockiert.
- `typescript@latest` (7.0) wird von typescript-eslint noch nicht unterstützt ⇒ TS 6.0.3 gepinnt.
