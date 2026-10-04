# Fortschrittsprotokoll

Laufendes Protokoll, neueste Einträge oben. Ergänzt die Häkchen in [PLAN.md](PLAN.md).
Verbindliche Spezifikation: [SPEC.md](SPEC.md).

## Aktueller Stand

- **Meilenstein:** M1 (Globus) fertig auf PR #1, CI grün (check + e2e), wartet auf unabhängigen Test und Florians „weiter“.
- **Nächster Schritt:** M2 – Bodenkontakt (Floating Origin auf der Gruppe `globe`, Bodenmodus, OSM-Gebäude via Overpass).
- **Blocker:** keiner. Google- und Cesium-Pfad brauchen echte Keys zur Sichtprüfung.

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
- Echte Satellitenbilder nur außerhalb der Sandbox sichtbar (Pages-Deploy oder lokal).

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

- Die Arbeitsumgebung blockiert EOX, NASA GIBS, Overpass, Photon, Nominatim, Open-Meteo und Cesium. Sichtprüfung mit echten Satellitenbildern ist hier erst nach Netzwerkfreigabe möglich.
- `typescript@latest` (7.0) wird von typescript-eslint noch nicht unterstützt ⇒ TS 6.0.3 gepinnt.
