# Entscheidungen (ADRs)

Kurzformat: Kontext · Entscheidung · Konsequenz.

## ADR-001 – TypeScript 6.0 statt 7.0 (2026-10-04)

- **Kontext:** `typescript@latest` ist 7.0 (nativer Compiler). `typescript-eslint` 8.71 unterstützt nur `>=4.8.4 <6.1.0`.
- **Entscheidung:** `typescript@6.0.3` gepinnt.
- **Konsequenz:** Type-checked Linting funktioniert. Upgrade auf 7.x, sobald typescript-eslint es unterstützt.

## ADR-002 – Preact 10 + Signals für das UI-Overlay (2026-10-04)

- **Kontext:** Auftrag schlägt Preact + Signals vor. Preact 11 ist gerade erschienen; Ökosystem (Preset, Hooks-Kompatibilität) ist auf 10 erprobt.
- **Entscheidung:** `preact@10.29.8`, `@preact/signals@2.11.3`, `@preact/preset-vite`. Globale UI-Zustände als Signals in `core/store.ts`.
- **Konsequenz:** ≈ 11 kB gzip für das gesamte Overlay. Upgrade auf 11 später als eigener Schritt.

## ADR-003 – Open-Data-Gelände über `TerrariumMeshPlugin` von 3d-tiles-renderer (2026-10-04, vorläufig)

- **Kontext:** Auftrag 5.3 verlangt Gelände aus AWS-Terrarium-Kacheln mit LOD-Quadtree auf dem Ellipsoid und Skirts. 3d-tiles-renderer 0.5.3 bringt genau dafür `TerrariumMeshPlugin` (Dekodierung `(R·256 + G + B/256) − 32768`, Skirts, Raycast) sowie `ImageOverlayPlugin` + `XYZTilesOverlay` für Satellitenbilder.
- **Entscheidung:** In M1 zuerst das Plugin nutzen, statt einen eigenen Quadtree zu bauen. Eigene `.d.ts`, weil das Plugin noch keine Typen hat. Kachel-Mesh ist im Plugin 32×32 statt 64×64.
- **Konsequenz:** Deutlich weniger eigener Code, gleiche LOD-/Culling-Logik wie für Google/Cesium. Falls Plugin-Grenzen (z. B. Krater-Patches im Shader) stören, wird in M4 ein eigener Terrain-Pfad gebaut. Wird in M1 bestätigt oder revidiert.

## ADR-004 – Engine und schwere Module per Lazy Load (2026-10-04)

- **Kontext:** Budget < 1,5 MB gzip initial; UI soll sofort erscheinen.
- **Entscheidung:** `main.ts` lädt nur das Overlay; `core/engine.ts` (three.js) via `import()`. Rapier und Werkzeuge der Stufen 4/5 ebenfalls dynamisch.
- **Konsequenz:** Initial ≈ 11 kB gzip, Engine-Chunk ≈ 132 kB gzip (M0).

## ADR-005 – Achsenzuordnung des lokalen ENU-Frames (2026-10-04)

- **Kontext:** three.js ist Y-up, ENU ist Z-up.
- **Entscheidung:** x = Ost, y = Oben, z = −Nord (rechtshändig).
- **Konsequenz:** Rapier-Gravitation zeigt nach −y; three.js-Standards (Schatten, Controls, Höhe = y) gelten unverändert.

## ADR-006 – Endpunkt-Prüfung über GitHub Actions (2026-10-04)

- **Kontext:** Die Arbeitsumgebung blockiert die meisten Datenhosts per Egress-Policy; Tests dürfen keine echten APIs ansprechen.
- **Entscheidung:** `scripts/check-endpoints.sh` prüft alle Endpunkte; Workflow „Endpoint check“ läuft wöchentlich, manuell und bei Änderungen am Skript. Er ist kein Pflicht-Check für PRs.
- **Konsequenz:** Ausfälle von Drittdiensten werden sichtbar, ohne die CI zu blockieren.

## ADR-007 – Sentinel-2 cloudless 2016 als Standard-Satellitenbild (2026-10-04)

- **Kontext:** Auftrag: CC-BY-Jahrgang bevorzugen. Ab 2017 gilt CC BY-NC-SA 4.0.
- **Entscheidung:** Layer `s2cloudless_3857` (2016) als Standard; neuere Jahrgänge optional in den Einstellungen mit eigener Attribution.
- **Konsequenz:** Ältere Bilder, aber die freieste Lizenz. Lizenz wird vor Aktivierung in M1 noch einmal verifiziert.

## ADR-008 – Rapier im Hauptthread (2026-10-04, vorläufig)

- **Kontext:** Auftrag 11 verlangt eine Begründung. Ein Worker spart Hauptthread-Zeit, braucht aber Transform-Synchronisation (SharedArrayBuffer erfordert COOP/COEP-Header, die GitHub Pages nicht setzen kann) und erschwert Raycasts, Character-Controller und Interpolation.
- **Entscheidung:** Rapier läuft in M3 im Hauptthread mit fester 60-Hz-Rate und Body-Budget pro Preset.
- **Konsequenz:** Einfacher, deterministischer Ablauf. Wenn Profiling in M4/M8 zeigt, dass die Physik das Frame-Budget sprengt, wird ein Worker mit `postMessage`-Transform-Puffern evaluiert.

## ADR-009 – Vite-`base` über `VITE_BASE` (2026-10-04)

- **Kontext:** GitHub Pages serviert unter `/<repo-name>/`, lokal und bei eigener Domain unter `/`.
- **Entscheidung:** `vite build` nutzt `VITE_BASE`, sonst `/WORLDSandboxGame/`. Der Deploy-Workflow setzt `VITE_BASE=/${repo-name}/`. `vite dev` nutzt immer `/`.
- **Konsequenz:** Umbenennen des Repos braucht keine Code-Änderung.

## ADR-010 – NASA GIBS Blue Marble als Ersatz-Satellitenbild (2026-10-04)

- **Kontext:** EOX ist der einzige frei lizenzierte Sentinel-2-Dienst ohne Key. Fällt er aus, wäre der Globus ohne Bild.
- **Entscheidung:** NASA GIBS Blue Marble (Shaded Relief + Bathymetrie, 9 Zoomstufen) ist der Ersatz.
- **Konsequenz:** Aus dem All sieht der Globus gleich gut aus, in Bodennähe ist er deutlich unschärfer.

## ADR-011 – `TileProvider.attach(ctx, settings)` statt Einzelargumente (2026-10-04)

- **Kontext:** Auftrag 4.2 skizziert `attach(renderer, scene, camera)`. Provider brauchen zusätzlich die Globus-Gruppe (ECEF → Y-up) und die Settings (Keys, Preset).
- **Entscheidung:** `attach(ctx: ProviderContext, settings)` mit `ctx = { renderer, scene, camera, globe }`.
- **Konsequenz:** Provider hängen ihre Tiles in `globe`; der Floating Origin in M2 verschiebt nur diese Gruppe.

## ADR-012 – Satellitenbild per Probe-Kachel wählen (2026-10-04)

- **Kontext:** Ein Overlay-Fehler lässt in 3d-tiles-renderer 0.5.3 auch die Geländekachel scheitern.
- **Entscheidung:** Beim Start lädt `pickImagery` die z0-Kachel von EOX; schlägt sie fehl, wird GIBS genommen.
- **Konsequenz:** Ein kompletter EOX-Ausfall wird abgefangen. Fällt EOX erst während der Sitzung aus, fehlen neue Kacheln bis zum Neuladen (bekannte Lücke, siehe PROGRESS.md).

## ADR-013 – Google-Key ohne separaten Test-Request (2026-10-04)

- **Kontext:** Jeder Abruf von `root.json` startet eine kostenpflichtige Google-Session.
- **Entscheidung:** `isAvailable` prüft nur, ob ein Key gesetzt ist. Das Laden des Root-Tilesets ist der Test; 400/401/403 gelten als ungültiger Key, 429 als Kontingent erschöpft, danach greift die Fallback-Kette mit Toast. Drei Auth- oder Kontingentfehler zur Laufzeit lösen ebenfalls den Fallback aus.
- **Konsequenz:** Kein zusätzlicher Session-Verbrauch. Cesium ion wird genauso behandelt.

## ADR-014 – errorTarget-Faktor für bildbasierte Höhenkacheln (2026-10-04)

- **Kontext:** Das `TerrariumMeshPlugin` rechnet den geometrischen Fehler pro Texel und empfiehlt `errorTarget = 1`. Die Presets (40/20/10/6 px) sind auf echte 3D-Tiles ausgelegt; mit 20 px war das Gelände sichtbar zu grob.
- **Entscheidung:** Provider haben einen `errorTargetScale`; Open Data nutzt 1/20, also 1 bei Preset „Mittel“.
- **Konsequenz:** Grafik-Presets wirken bei allen Quellen vergleichbar.
