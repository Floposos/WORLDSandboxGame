# Fortschrittsprotokoll

Laufendes Protokoll, neueste Einträge oben. Ergänzt die Häkchen in [PLAN.md](PLAN.md).

## 2026-10-04 – M0 Projektgerüst

**Erledigt**

- Aktuelle Doku von `three` 0.186.1, `3d-tiles-renderer` 0.5.3 und `@dimforge/rapier3d-compat` 0.21.0 in den installierten Paketen gelesen, Versionen gepinnt. Fund: `TerrariumMeshPlugin` in 3d-tiles-renderer deckt das Open-Data-Gelände ab (ADR-003).
- Endpunkte aus Abschnitt 5 geprüft (Ergebnisse in PLAN.md). Prüfskript `scripts/check-endpoints.sh` + Workflow „Endpoint check“.
- Gerüst: Vite 8, TypeScript 6 strict, ESLint 10, Prettier, Vitest (22 Tests), Playwright-Smoketest.
- Leere Szene mit FPS-Anzeige, Game-Loop (60 Hz fest, Zeitskala), EventBus, PRNG, Settings, UI-Overlay (Preact), Fehler-Toast, i18n.
- CI-Workflow und GitHub-Pages-Deploy. PR #1 geöffnet.
- Doku: PLAN, ARCHITECTURE, DECISIONS (9 ADRs), TOOLS, README und ATTRIBUTIONS (Rohfassung).

**Offen**

- CI auf PR #1 grün bestätigen; Ergebnis des Endpunkt-Checks vom GitHub-Runner in PLAN.md übernehmen.
- GitHub Pages in den Repo-Einstellungen auf „GitHub Actions“ stellen (Florian).
- M1 startet nach Florians „weiter“.

**Probleme**

- Die Arbeitsumgebung blockiert EOX, NASA GIBS, Overpass, Photon, Nominatim, Open-Meteo und Cesium. Sichtprüfung mit echten Satellitenbildern ist hier erst nach Netzwerkfreigabe möglich.
- `typescript@latest` (7.0) wird von typescript-eslint noch nicht unterstützt ⇒ TS 6.0.3 gepinnt.
