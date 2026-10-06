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
- **Abgelöst** durch ADR-025 (2025 als Standard, 2016 wählbar).

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

## ADR-015 – Kamera an gemessener Geländehöhe klemmen, fehlgeschlagene Kacheln wiederholen (2026-10-04)

- **Kontext:** `GlobeControls` hält die Kamera nur über dem gerenderten Mesh. Bei langsamem Netz ist lange nur die grobe Wurzelkachel geladen (an der Zugspitze bei −3.640 m), und die Kamera konnte beim Neigen tief in Berge eintauchen. Außerdem lädt 3d-tiles-renderer fehlgeschlagene Kacheln nie neu.
- **Entscheidung:** `GlobeCamera` ersetzt die private Methode `_getPointBelowCamera` der Controls: Liegt die gemessene Höhe (`provider.sampleHeight`) mehr als 150 m über dem Mesh-Treffer, gilt sie als Boden. Kleinere Abweichungen bleiben beim Mesh (Geoid-Versatz Terrarium/ellipsoidisch). `TilesProviderBase` ruft nach Netz-, 408-, 429- und 5xx-Fehlern `resetFailedTiles()` mit Backoff 2 s → 30 s auf, nicht bei 404 und Auth-Fehlern.
- **Konsequenz:** Kein Eintauchen mehr, auch solange das Gelände noch grob ist. Die Überschreibung hängt an einer privaten API von 3d-tiles-renderer 0.5.3 und muss bei Updates geprüft werden (Unit-Test für die Auswahl-Logik vorhanden).

## ADR-016 – Floating Origin: Welt = lokaler ENU-Frame, Verschiebung nur im Ruhezustand (2026-10-04)

- **Kontext:** Spec 4.2 verlangt einen lokalen ENU-Frame mit Ursprungsverschiebung ab 5 km. `GlobeControls` speichern Punkte und Richtungen in Weltkoordinaten (Pivot, Zoom-Punkt, Trägheit, Up).
- **Entscheidung:** Die Gruppe `globe` trägt die Matrix ECEF → lokal; die Welt-Koordinaten von three.js sind direkt ENU (x = Ost, y = Oben, z = −Nord). Schwelle max(5 km, 2 × Höhe über Grund), damit im All nicht jedes Frame verschoben wird. Im Globusmodus wird nur verschoben, wenn keine Geste und keine Trägheit aktiv sind; die verbleibenden Vektoren der Controls werden mit D umgerechnet. Flug-/Bodenkamera verschieben jederzeit.
- **Konsequenz:** Am Boden liegen Kamera und Spielobjekte immer innerhalb weniger km um (0,0,0), was Rapier (Float32) und die Tiefenauflösung brauchen. Während langer Gesten im Globusmodus kann die Kamera kurz weiter als 5 km entfernt sein; das ist unkritisch, weil three.js die Modelview-Matrizen in Float64 rechnet.

## ADR-017 – Bodenkamera ohne Physik bis M3 (2026-10-04)

- **Kontext:** Spec 6.1 nennt für die Bodenkamera den Rapier-Character-Controller. Rapier und die Physik-Blase kommen erst in M3.
- **Entscheidung:** Die Bodenkamera läuft in M2 mit einer einfachen Bodenabfrage: Position geodätisch, Füße auf der Bodenhöhe (`GroundService`), Hindernisse höher als 0,6 m blockieren (Abfrage von 50 m oben), Sprung mit 4,5 m/s und g. Markiert als `SIMPLIFIED`.
- **Konsequenz:** Gehen und Springen funktionieren auf Gelände. Mit Google/Cesium-Meshes blockieren auch Bäume und Brücken über dem Weg. In M3 übernimmt der Rapier-Character-Controller mit Kollisionen.

## ADR-018 – Leertaste: Pause, im Bodenmodus Sprung (2026-10-04)

- **Kontext:** Spec 10 belegt die Leertaste mit Pause, die Bodenkamera (Spec 6.1) braucht einen Sprung. Der unabhängige M2-Test hat den Konflikt angemerkt.
- **Entscheidung:** Leertaste pausiert bzw. setzt fort, außer im Bodenmodus: dort springt sie, wie in Ego-Spielen üblich. `P` pausiert in jedem Modus, `T` schaltet Zeitlupe (0,25×) um. Tastendrücke werden zwischen zwei Frames gepuffert, damit ein kurzer Tipp bei niedriger Bildrate nicht verloren geht.
- **Konsequenz:** Im Bodenmodus pausiert man mit `P`; der Hinweis in der Modusleiste nennt das.

## ADR-019 – Gebäude zellenweise per Rechteck laden (2026-10-04)

- **Kontext:** Spec 5.4 zeigt eine `around`-Abfrage um den Fokus und verlangt einen Cache mit Geohash-6-Schlüssel. Eine Kreisabfrage lässt sich nicht pro Zelle cachen. Florian wünscht sichtbar tiefe Städte, der Blasenradius (600 m) wirkt dafür klein.
- **Entscheidung:** Abfrage per Rechteck der fehlenden Geohash-6-Zellen (bis 4 Zellen je Anfrage), Zuordnung der Gebäude zur Zelle über ihren Schwerpunkt, Cache je Zelle (Speicher-LRU + IndexedDB, 7 Tage wie Spec 5). Geladen wird um die Bildmitte, Radius 1,5 × Blasenradius, mindestens 800 m, nur unter 6 km Kamerahöhe. `out geom` statt `out geom tags`, weil `tags` die Relationsmitglieder samt Geometrie weglässt. Dachformen flach (`SIMPLIFIED`), Fenster als prozedurales Raster im Shader statt Textur-Atlas. Parsing im Hauptthread (`SIMPLIFIED`, Worker bei Bedarf nach Profiling).
- **Konsequenz:** Jede Zelle wird höchstens einmal angefragt; Bewegen lädt nur neue Zellen nach. Overpass ist in der Cloud-Sandbox gesperrt; der Workflow „Overpass snapshot“ legt echte Daten im Branch `ci-snapshots` ab, die `scripts/screenshot-live.mjs` und `scripts/m3-check.mjs` per `OVERPASS_SNAPSHOT` einspielen.

## ADR-020 – Simulationsblase mit eigenem Tangential-Frame, Rapier im Hauptthread (2026-10-04)

- **Kontext:** Spec 4.2 verschiebt bei Ursprungswechsel alle Rapier-Bodies; Spec 11 lässt Rapier im Hauptthread oder Worker zu.
- **Entscheidung:** Die Blase hat einen eigenen ENU-Frame (Mitte auf Geländehöhe), dessen Gruppe im ECEF-Globus hängt. Rapier rechnet in diesem Frame, die Schwerkraft zeigt exakt nach −y, Ursprungsverschiebungen der Kamera berühren die Physik nicht (gleiches Ergebnis wie das Verschieben aller Bodies, ohne Aufwand und ohne Rundungsfehler). Liegt ein Werkzeugziel außerhalb von 80 % des Radius, wird die Blase dort neu aufgebaut und die alten Objekte verschwinden. Rapier läuft im Hauptthread: die Schrittzeit liegt bei 0,2 ms für 200 schlafende Kisten, ein Worker brächte Kopieraufwand und Latenz für Raycasts. `rapier3d-compat` (WASM als Base64) wird erst beim ersten Werkzeug bzw. im Bodenmodus geladen.
- **Konsequenz:** Rapier-Koordinaten bleiben unter dem Blasenradius (Float32 reicht). Objekte überleben keine Verlegung der Blase; das ist mit „Blase zurücksetzen“ (M7) konsistent.

## ADR-021 – Gebäude als statische Trimesh-Collider, Bodenkamera über Physik-Raycasts (2026-10-04)

- **Kontext:** Spec 7.1 nennt Box- bzw. Convex-Hull-Collider für Gebäude. OSM-Grundrisse sind oft L- oder U-förmig, eine konvexe Hülle würde Innenhöfe füllen. ADR-017 ließ die Bodenkamera ohne Kollision.
- **Entscheidung:** Je Gebäude ein fester Trimesh-Collider aus genau den extrudierten Dreiecken (gleiche Form wie sichtbar). Die Bodenabfrage (`GroundService`) nimmt zusätzlich den Raycast der Blase; liegt dessen Treffer höher als der Boden, gilt er (Dächer, Kisten, Mauern). Im Bodenmodus wandert eine leere Blase mit der Kamera, damit Gebäude überall blockieren. Der Rapier-Character-Controller ersetzt die einfache Gehlogik noch nicht (`SIMPLIFIED`, ADR-017 gilt für das Gehen weiter).
- **Konsequenz:** Kisten liegen exakt auf den sichtbaren Dächern. In M4 werden zerstörte Gebäude durch dynamische Bruchstücke ersetzt; die Trimesh-Collider entfallen dann je Gebäude.

## ADR-022 – Zerstörung: Krater als Maske plus Mesh, Abschirmung, Bruchschwelle 100 kPa (2026-10-04)

- **Kontext:** Spec 7.4 sieht Krater im Open-Data-Modus als Verformung im Gelände-Shader vor, Spec 7.2 eine eigene Datei `world/buildings/destructible.ts`. Die Abnahme verlangt für 500 kg in der Hamburger Altstadt 1–3 eingestürzte Gebäude; der reine Kinney-Graham-Druck mit realen Mauerwerk-Schwellen (35–70 kPa) brachte im dichten Block 6–10 Einstürze.
- **Entscheidung:** Krater nutzen in beiden Modi dieselbe Technik: Maske über der Schüssel plus eigenes Krater-Mesh mit Wall, das zum Gelände ausblendet. Die Zerstörung liegt in `physics/destruction.ts` (braucht Rapier und die Blase), der Bruch in `physics/fracture.ts`. Bruchschwelle 100 kPa an der nächsten Seite eines Stücks; ein anderes stehendes Gebäude zwischen Explosion und Stück dämpft den Druck auf 35 % (`SIMPLIFIED`: Grundriss-Schnitt im Plan statt Strahlverfolgung). Löst eine Explosion an einem Gebäude kein Stück, wird der Vorab-Bruch zurückgenommen. Fliegerbomben zünden am Boden unter dem Treffpunkt (Verzögerungszünder). Die Proxy-Farben kommen aus den OSM-Tags, nicht aus der Fotogrammetrie (`SIMPLIFIED`). Zellen je Stockwerk richten sich nur nach der Fläche (4–12), noch nicht nach dem Preset.
- **Konsequenz:** Ein Shader-Pfad weniger, Krater sehen in allen Modi gleich aus. 500 kg in Hamburg: Krater 9,5 m, 2 eingestürzte und 5 beschädigte Gebäude. Jedes Bruchstück ist ein eigenes Mesh (ein Draw-Call); bei mehreren hundert Stücken ist das der größte Posten pro Frame.

## ADR-023 – Wetter, Wasser und Katastrophen: Näherungen und Grenzen (2026-10-05)

- **Kontext:** Spec 5.5 nennt für Open-Meteo nur `current=…` ohne `weather_code`; damit sind Nebel und Gewitter nicht von „bewölkt“ zu unterscheiden. Spec 6.3 verlangt einen Ozean-Shader auf dem Ellipsoid, Spec 8 Katastrophen, deren echte Zeitabläufe (Meteor-Anflug in Sekundenbruchteilen, Tornado über Stunden) unspielbar wären.
- **Entscheidung:** Die Abfrage enthält zusätzlich `weather_code` (WMO) und `wind_speed_unit=ms`; alle Felder der Spezifikation bleiben enthalten. Cache 15 min je 0,1°-Rasterpunkt. Wasser gibt es vorerst nur als Flut- bzw. Tsunami-Fläche in der Blase (`SIMPLIFIED`), nicht global auf dem Ellipsoid; der Shader (Normalmap, Fresnel, Glanz) ist schon der endgültige. Zeitabläufe sind spielbar gestreckt: Meteor-Anflug 4,5 s, Tornado zieht mit 12 m/s, Vulkankegel wächst in 20 s. Katastrophen schaden Gebäuden über eigene Regeln (`Destruction.damage`), nicht über Überdruck: Tornado nach Windgeschwindigkeit je Stockwerkshöhe (Dach ab 40 m/s, Erdgeschoss ab 95 m/s), Erdbeben nach Bodenbeschleunigung gegen eine je Gebäude zufällige Tragfähigkeit. Im Meteorkrater und unter dem Vulkankegel verschwinden Gebäude ohne Bruchstücke (`vaporize`), sonst entstünden Zehntausende Körper.
- **Konsequenz:** Ein EF3-Tornado deckt Dächer ab und lässt einzelne Häuser einstürzen, ein EF5 trägt ganze Häuser ab. Ein 50-m-Meteor hinterlässt einen Krater von 1,4 km und löscht die Blase aus – das ist physikalisch richtig, aber die Simulationsblase (600 m) ist dann kleiner als der Krater. Feste Bruchstücke zählen nicht mehr zum Body-Budget, damit gebrochene, aber stehende Gebäude die fliegenden Trümmer nicht verdrängen.

## ADR-024 – Apokalypse: Effekt-Hülle auf dem Globus, stilisierte Formeln, Welt-Reset (2026-10-05)

- **Kontext:** Spec 8 verlangt für Stufe 5 Wirkungen weit über die 600-m-Blase hinaus (Druckwelle über die Blase hinaus, globaler Staubschleier, Mond-Absturz), die aus dem All sichtbar sein sollen. Die gestreamten Kacheln lassen sich nicht global verformen oder umfärben, und Hunderte Kilometer Simulation sind unmöglich.
- **Entscheidung:** Alles außerhalb der Blase ist rein visuell und liegt auf einer **Effekt-Hülle**: ein Ellipsoid 10 km über dem WGS84 mit einem Shader, der bis zu 8 Ereignisse (je vier vec4) zeichnet. Winkel kommen aus der Sehne zwischen Normalen (`2·asin(|n−c|/2)`), damit kleine Ringe präzise bleiben; Linien sind mindestens 1,5 px breit (`fwidth`). Unter 30 km Kamerahöhe blendet die Hülle aus und flache Bodenringe übernehmen. Formeln (`SIMPLIFIED`, spielerisch): Feuerball 66 m · W^0,4 (W in kt), schwere Zerstörung bei 20 psi und leichte bei 1 psi über Kinney-Graham, Pilzwolke H = 3,4 km · W^0,25, Luftdetonation in 1,2 Feuerballradien. Asteroid: Endkrater nach Collins et al. (komplex ab 3,2 km, am Übergang stetig gehalten), Verdunkelung (log₁₀E − 19)/4,5, ab 10 km die ganze Erde. Mond: keine Bahnmechanik, Spiralbahn in 16 s Simulationszeit (≈ 4,8 Tage Zeitraffer), Zerreißen an der Roche-Grenze (18 470 km), Kamera als Skript über `GlobeCamera.setScript`. Opferzahlen gibt es nicht. Ein neuer globaler Befehl „Welt zurücksetzen“ räumt Effekte, Krater, Masken und Trümmer ab und baut die Blase am selben Ort neu.
- **Konsequenz:** Die Wirkung ist aus jeder Höhe sichtbar und kostet einen Draw-Call. Die Hülle folgt dem Gelände nicht (Gebirge können durchstoßen), Wirkungen außerhalb der Blase verändern weder Gelände noch Gebäude. Für den Mond werden Nah- und Fernebene der Kamera während der Sequenz aufgeweitet, weil die Globus-Steuerung die Nahebene knapp vor die Erde legt.

## ADR-025 – Bildqualität: Sentinel-2 2025 als Standard, Aufhellung in Bodennähe, größerer Gebäude-Ladekreis (2026-10-06)

- **Kontext:** Florians Test nach M6: Beim Hineinzoomen wird die Erde nachts schwarz, das Satellitenbild wirkt matschig, in der Stadt bleiben große Flächen ohne Gebäude. Weltweit gibt es kein offenes Satellitenbild über 10 m Auflösung; EOX liefert aber neuere Sentinel-2-Jahrgänge, die deutlich schärfer und klarer prozessiert sind als 2016 (Vergleich über Berlin, z15). Sie stehen unter CC BY-NC-SA 4.0 (Abstract im WMTS-Capabilities-Dokument von EOX, geprüft 2026-10-06). Spec 5 bevorzugt den CC-BY-Jahrgang (ADR-007).
- **Entscheidung:** Standard ist `s2cloudless-2025_3857` mit eigener Attribution und Lizenz CC BY-NC-SA; „Sentinel-2 2016 (CC BY)“ bleibt in den Einstellungen wählbar und ist Ersatz, falls 2025 nicht antwortet (dann GIBS). Die Abweichung von Spec 5 liegt Florian als Entscheidung vor; GlobeBox ist ein nicht-kommerzielles Projekt. Alle Kacheltexturen bekommen die höchste anisotrope Filterung. Ein eigenes, fast neutrales Umgebungslicht hebt die Oberfläche unter 200 km Kamerahöhe an (voll unter 30 km): tagsüber +1,1, nachts +1,7; aus dem All bleibt die Nachtseite dunkel (`SIMPLIFIED`: kein Mondlicht, keine Stadtlichter). Der Gebäude-Ladekreis wächst mit der Kamerahöhe (1,6 × Höhe über Grund, höchstens 3,5 km, vorher fest ≈ 900 m), bis zu 120 Zellen im Speicher.
- **Konsequenz:** Bei 2025 darf GlobeBox nicht kommerziell vertrieben werden. Nachts in Bodennähe ist die Stadt lesbar (Helligkeit der Bildmitte in Berlin aus 2 km: 14 → 52 von 255, mittags 56 → 63). Aus 2 km Höhe werden rund 70 Zellen geladen statt 6; das dauert mit Overpass länger, nächste Zellen zuerst.

## ADR-026 – Spielschicht im Stil einer Strategiekarte, Etappe 1: Länder (2026-10-06)

- **Kontext:** Florian wünscht nach M6 eine Spiellogik wie in Crusader Kings: Ländergrenzen weltweit kilometergenau, Truppen je Land, Steuerung wie in Age of Empires, Kriege, Politik und Allianzen. Spec Abschnitt 9 kennt das nicht; M7 (Komfort) und M8 (Release) bleiben unverändert.
- **Entscheidung:** Zusätzliche Meilensteine „Spielschicht“ S1–S4 (PLAN.md), je Etappe ein PR mit unabhängigem Test: S1 Grenzen und Länder, S2 Einheiten und Bewegung, S3 Krieg, S4 Allianzen. Daten für S1: Natural Earth 1:10 Mio. Admin 0 (v5.1.2, gemeinfrei), 255 Länder auf Ebene ADM0 (z. B. Grönland eigenständig), aufbereitet von `scripts/build-countries.mjs` zu `public/data/countries.json` (≈ 3 MB, gzip ≈ 1,3 MB, erst zur Laufzeit geladen). Vereinfachung mit 0,005° (≈ 500 m) für Flächen und 0,0025° für Landgrenzen: kilometergenau, aber klein genug. Darstellung: Landgrenzen als breite Linien (2 px, dunkler Saum) auf dem Ellipsoid, ohne Tiefentest mit Horizonttest im Shader; Länderflächen als getönte Hülle aus einer Länder-ID-Textur (4096 × 2048, zur Laufzeit gerastert) und einer Farbtabelle je Land (später Besitzwechsel im Krieg); Namen als HTML-Beschriftung, Größe nach Bildschirmfläche, ohne Überlappung. Länderwahl: Klick ohne Werkzeug im Globusmodus, Strahl gegen das WGS84-Ellipsoid, Punkt-in-Polygon. Taste G und ein Knopf neben dem Zahnrad schalten die Karte (Einstellung, Standard an).
- **Konsequenz:** `SIMPLIFIED`: Linien liegen auf dem Ellipsoid und werden nicht vom Gelände verdeckt (in Bodennähe blasser); umstrittene Gebiete nach der De-facto-Sicht von Natural Earth; Inseln unter ≈ 500 m fallen weg.

## ADR-027 – Spielschicht S2: Einheiten und Steuerung (2026-10-06)

- **Kontext:** Florian möchte Panzer, Bodentruppen und Luftwaffe einem Land zuordnen (im Land platzieren oder nachträglich zuweisen), sie wie in Age of Empires mit einem Rahmen auswählen und per Linksklick bewegen. Die Truppen sollen groß dargestellt werden und auch aus großer Höhe als Verband sichtbar bleiben (wie in Crusader Kings).
- **Entscheidung:** Drei Typen (Infanterie 5 km/h, Panzer 40 km/h, Luftwaffe 700 km/h; Stärke 1 000 / 50 / 20) bewegen sich auf Großkreisen. Die Spielzeit läuft mit 1 Spielstunde je Echtsekunde, Pause und Zeitlupe gelten auch hier. Bodentruppen setzen und marschieren nur an Land (Land = Fläche eines Landes aus S1). Wer in einem Land platziert, gehört diesem Land, sonst dem gewählten Land. Die Auswahl kann über eine Liste jedem Land zugewiesen werden. Die Steuerung lebt in einem Truppen-Modus (Taste U oder Fahnenknopf):
  - **Befehlen:** Linkes Ziehen zeichnet den Auswahlrahmen, ein Klick auf ein Symbol wählt es aus (Umschalt fügt hinzu), ein Klick auf die Karte schickt die Auswahl als Raster los. Der Abstand im Raster richtet sich nach der Kamerahöhe.
  - **Navigation:** Dafür bekommt die Globus-Steuerung im Befehlsmodus die linke Taste nicht. WASD/Pfeile verschieben die Karte, die rechte Maustaste dreht, das Mausrad zoomt.
  - **Platzieren:** Ein Klick setzt eine Einheit des gewählten Typs, Ziehen dreht weiter die Erde.
  - **Darstellung:** Die Symbole sind HTML (NATO-Taktikzeichen, Landesfarbe als Streifen) mit fester Bildschirmgröße. Überlappende Symbole desselben Landes werden zu einem Stapel mit Anzahl zusammengefasst, Marschlinien erscheinen nur für die Auswahl.
  - **Speichern:** Der Zustand liegt im localStorage (`globebox:army`).
- **Konsequenz:** `SIMPLIFIED`: keine Wegfindung, kein Gelände, kein Nachschub. Bodentruppen können unterwegs Meeresengen queren, nur Ziele auf dem Meer werden verweigert. Kämpfe folgen in S3.
