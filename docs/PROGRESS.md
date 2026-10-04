# Fortschrittsprotokoll

Laufendes Protokoll, neueste Einträge oben. Ergänzt die Häkchen in [PLAN.md](PLAN.md).
Verbindliche Spezifikation: [SPEC.md](SPEC.md).

## Aktueller Stand

- **Meilenstein:** M2 – Bodenkontakt abgeschlossen (Branch `claude/project-thread-oyqt5h`, PR #2), unabhängiger Test steht aus. Florian hat für seine Abwesenheit „weiter“ gegeben: **M3 – Physik & Bauen läuft.**
- **Nächster Schritt:** M3 nach Spec Abschnitt 9 planen (Rapier lazy laden, Blase, Werfen/Stapeln, Fahrzeuge, Character-Controller für die Bodenkamera statt ADR-017), Plan hier eintragen.
- **Umgebung:** Neue Cloud-Umgebung mit Netzwerkfreigabe. `scripts/check-endpoints.sh` am 2026-10-04: alles erreichbar außer **Overpass** (overpass-api.de: Verbindungsabbruch, private.coffee: Proxy 403, kumi.systems: Timeout). Overpass wird erst ab M4 gebraucht; Florian kann die Hosts in der Umgebung freigeben. Sichtprüfung mit echten Daten: `node scripts/screenshot-live.mjs` (holt externe Anfragen über Node, weil Chromium über den Sandbox-Proxy ~4 s pro Anfrage braucht). Software-Rendering: 2–5 FPS, Kacheln am Boden laden langsam.
- **Blocker:** keiner. Google- und Cesium-Pfad brauchen echte Keys zur Sichtprüfung.

## 2026-10-04 – M2 Bodenkontakt

**Erledigt**

- Floating Origin (`core/floatingOrigin.ts`, ADR-016), `GroundService` (`world/ground.ts`), Raycast über alle Tilesets.
- Kameras: Flug (WASD/QE/Shift, Tempo ∝ Höhe), Boden (1,8 m, Gehen/Rennen/Springen, ADR-017), Verfolgen (für M4 vorbereitet), `CameraRig` mit Tasten 1–4 und Modusleiste. Suche aus Flug-/Bodenmodus landet nach dem Flug wieder im Modus.
- Zielkreis-Vorschau mit Blasenradius, auf das Gelände drapiert. Reversed-Z-Tiefenpuffer. Himmel tagsüber blau statt schwarz (`SIMPLIFIED`, echte Streuung M5).
- Unterwegs behoben: Kamera sprang nach „Fliege zu“ 10 km hoch (grobe Kachel über dem Boden, ADR-015 erweitert: bei Open Data gilt die gemessene Höhe); Suchliste ging nach der Auswahl wieder auf; `resetFailedTiles()` von 3d-tiles-renderer warf bei unvollständigen Kacheln (eigene, sichere Variante).
- 151 Unit-Tests, 3 E2E. Abnahme in Tokio (Shibuya) und Buenos Aires (Plaza de Mayo): Kamera am Boden < 2 km vom Ursprung, Positionsstreuung im Stand 0 mm, Gehen ohne Einsinken, Wechsel per Suche. Screenshots in `globebox/m2/`.

**Probleme / bekannt kaputt**

- Am Boden ist Sentinel-2 (10 m/Pixel) naturgemäß unscharf; Straßen erkennt man erst mit Google/Cesium.
- Bodenkamera ohne echte Kollision (ADR-017); mit Google/Cesium blockieren Bäume und Brücken.
- Zielkreis zeichnet ohne Tiefentest; am Boden erscheint er als Linie am Horizont.

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
