# Fortschrittsprotokoll

Laufendes Protokoll, neueste Einträge oben. Ergänzt die Häkchen in [PLAN.md](PLAN.md).
Verbindliche Spezifikation: [SPEC.md](SPEC.md).

## Aktueller Stand

- **Meilenstein:** Qualitätsrunde gemergt (PR #8, ADR-025). Spielschicht im Stil von Crusader Kings als Etappen S1–S4 (ADR-026, PLAN.md); S1 (Grenzen und Länder) als PR #9 getestet, S2 (Einheiten und Bewegung) fertig.
- **Nächster Schritt:** S2 als PR mit unabhängigem Test, dann S3 (Krieg).
- **Umgebung:** Overpass in der Cloud-Sandbox gesperrt (auch nach Florians Freigabe). Echte Daten kommen aus dem Workflow „Overpass snapshot“ (Branch `ci-snapshots`: Berlin-Mitte, Hamburg-Altstadt, Tokio-Shibuya); `OVERPASS_SNAPSHOT=<datei>` in `scripts/m3-check.mjs`, `scripts/m4-check.mjs`, `scripts/m5-check.mjs`, `scripts/m6-check.mjs`, `scripts/screenshot-live.mjs`. Photon antwortet im Browser zeitweise nicht; `LATLON=<lat>,<lon>` umgeht die Suche in `m5-check.mjs`. Software-Rendering: 1–3 FPS.
- **Blocker:** keiner. Offen: Die FPS-Abnahmen stehen weiter aus, weil in der Sandbox nur Software-Rendering läuft und Florian gerade keinen passenden Rechner zur Hand hat (kein Blocker für die Entwicklung). Der Google-Modus braucht einen Key.

## 2026-10-06 – Spielschicht S2: Einheiten und Bewegung

**Erledigt**

- `src/game/units.ts`: Einheiten, Zuweisung, Marschbefehle als Raster, Bewegung auf Großkreisen, Speichern/Laden (Unit-Tests).
- `src/game/army.ts`: Truppen-Modus (Taste U, Fahnenknopf): Platzieren (gehört dem Land unter dem Klick), Befehlen (Rahmen ziehen, Klick auf Symbol, Klick auf die Karte schickt los), WASD/Pfeile verschieben die Karte, Entf löscht, Esc hebt die Auswahl auf. Symbole als NATO-Zeichen mit Landesfarbe, stapeln sich mit Anzahl.
- Truppen-Panel rechts: Modus, Auswahl, Land zuweisen, Anhalten, Entfernen. E2E-Test „Truppen“.

**Probleme / bekannt kaputt**

- Keine Wegfindung: Bodentruppen fahren geradeaus, auch über Meeresengen.

## 2026-10-06 – Spielschicht S1: Grenzen und Länder

**Erledigt**

- `scripts/build-countries.mjs` bereitet Natural Earth 1:10 Mio. auf (255 Länder, 282 000 Punkte, Landgrenzen 55 000 Punkte), `public/data/countries.json`.
- `src/game/`: `countries.ts` (Punkt-in-Polygon mit Suchgitter, ID-Raster), `politicalMap.ts` (Grenzlinien mit Horizonttest, getönte Flächen, Auswahl-Umriss), `gameLayer.ts` (Laden, Klick, Hover, Beschriftungen).
- UI: Kartenknopf neben dem Zahnrad, Taste G, Ländernamen, Steckbrief des gewählten Landes, Esc hebt die Auswahl auf. Attribution „Made with Natural Earth“.
- Tests: Grenzen kilometergenau (Kehl/Straßburg, Basel/Weil am Rhein), Raster gegen Punkttest, Ellipsoid-Treffer; E2E-Test „Politische Karte“.
- Werkzeuge: Ein Treffer auf einer noch groben Kachel (bis Kilometer unter dem Gelände) wird gegen das Höhenmodell korrigiert (`src/tools/coarseHit.ts`); liegt der genaue Treffer außerhalb der Blase, wird sie einmal nachgezogen. Unter Last setzte das die Blase vorher unter die Erde (E2E „Kiste“ rot).
- Leistung: Grenzlinien in 5°-Stücken (aus über 300 km Höhe 30°), Stücke hinter dem Horizont werden nicht gezeichnet.
- Befunde des unabhängigen Tests (2026-10-07) behoben:
  - Draw-Calls aus dem All 421 → 45 (aus großer Höhe 30°-Stücke, unter 300 km weiter 5°), aus 1 500 km 97 → 23.
  - Grenzlinien bleiben aus wenigen km Höhe kräftig (mindestens 75 % Deckkraft, Saum dunkler).
  - Fläche zieht Enklaven ab (Südafrika ohne Lesotho ≈ 1,22 Mio. km²).
  - Unter 1,5 km über Grund blenden die Linien aus, bis 300 m ganz weg (keine Grenze quer über den Horizont der Bodenkamera).
  - Tönung erst ab 120 km Höhe (die ID-Karte hat ≈ 10 km je Pixel).
  - Ländernamen mit dunklem Textsaum.
- E2E „Bodenkamera“ läuft, bis sich die HUD-Koordinaten ändern (in CI bei wenigen FPS zu knapp).

**Probleme / bekannt kaputt**

- Grenzlinien liegen auf dem Ellipsoid: im Gebirge nicht vom Gelände verdeckt.
- Grenzen in De-facto-Sicht (Natural Earth Standard, z. B. Krim bei Russland); Florian hat am 2026-10-07 so entschieden.

## 2026-10-06 – Qualitätsrunde nach Florians Test

**Erledigt**

- Satellitenbild: Sentinel-2 cloudless 2025 als Standard (deutlich schärfer als 2016, CC BY-NC-SA), 2016 (CC BY) in den Einstellungen wählbar; anisotrope Filterung auf allen Kacheltexturen (ADR-025). Entscheidung zur Lizenz liegt bei Florian.
- Nachtseite: eigenes Umgebungslicht in Bodennähe, nachts stärker; aus dem All bleibt die Nacht dunkel. Messung Berlin (Bildmitte, 0–255): nachts aus 2 km 14 → 52, aus 300 m 21 → 77, mittags 56 → 63 bzw. 78 → 94, aus 3 000 km unverändert 5.
- Gebäude: Ladekreis wächst mit der Kamerahöhe (bis 3,5 km statt ≈ 900 m), 120 Zellen im Speicher. Berlin aus 1,5 km: 70 Zellen nach 30 s.
- `scripts/quality-check.mjs` (Modi `light`, `buildings`) misst Helligkeit und Gebäudeabdeckung.
- Befunde des unabhängigen Tests behoben: Quellenangabe im EOX-Wortlaut („EOxCloudless https://cloudless.eox.at …“), Ladekreis wird gekappt, wenn er mehr als 100 Zellen wünscht (Oslo, Reykjavík), `check-endpoints.sh` prüft 2025 und 2016, Nachtaufhellung leicht bläulich.

**Probleme / bekannt kaputt**

- Mehr als 10 m Auflösung gibt es weltweit nicht als Open Data. Schärfer ginge es nur regional (z. B. offene Orthofotos deutscher Länder, 20 cm) oder mit Google/Cesium-Key.
- Mit echtem Overpass ist der größere Ladekreis langsamer (rund 20 Anfragen aus 2 km Höhe); Fehler oder Drosselung lassen Lücken, die nach 30 s neu versucht werden.

## 2026-10-05 – M6 Apokalypse

**Erledigt**

- Effekt-Hülle um den Globus (Ellipsoid 10 km über WGS84, ein Shader für bis zu 8 Ereignisse): Wirkungsringe, Druckwelle, Krater, Glut, Staubschleier, Lichtblitz, sichtbar ab 30 km Kamerahöhe (ADR-024). Darunter flache Bodenringe.
- Pilzwolke mit Noise-Shader (Stiel, Hut, Kondensationsring, Fuß), steigt in 22 s auf.
- Werkzeuge Stufe 5: Mega-Bombe (1 kt–50 Mt, logarithmischer Regler, Luft-/Bodendetonation, in der Blase echte Druckwelle), Asteroid (aus der Globusansicht, Krater nach Collins, Verdunkelung von Himmel, Sonne und Sicht), Mond-Absturz (filmische Sequenz mit Zeitraffer, Kamera-Skript, Untertiteln und Reset-Angebot).
- Hinweis-Dialog beim ersten Einsatz der Stufe 5, „Welt zurücksetzen“ als Knopf neben dem Zahnrad.
- 284 Unit-Tests (19 neue), E2E-Test für Hinweis, Mega-Bombe vom Globus und Reset (5 E2E).
- Abnahme im Browser, Bilder in `globebox/m6/`: 50 Mt über Hamburg aus 1 500 und 7 000 km als Ring mit Glutkern sichtbar. 100 kt in der Altstadt (echte OSM-Daten): Pilzwolke aus 25 km sichtbar, 188 Gebäude eingestürzt. Asteroid 10 km: 75 Tt TNT, Krater 119 km, Erde verdunkelt; Reset stellt alles wieder her. Mond-Absturz vollständig, 0 Konsolenfehler, danach Reset ohne Reste.
- Unterwegs behoben: Der Mond war unsichtbar, weil die Globus-Steuerung die Nahebene knapp vor die Erde legt; während der Sequenz werden Nah- und Fernebene aufgeweitet. Der Collins-Endkrater sprang am Übergang einfach/komplex nach unten, er bleibt dort jetzt bei 3,2 km.

- Unabhängiger Test bestanden (Bericht `globebox/m6-test/testbericht.md`). Befunde behoben: Tasten 1–4 wechseln während der Mond-Sequenz nicht mehr den Kameramodus (vorher schwarzes Bild); Suche, Modusleiste, Werkzeugleiste und Panel sind während der Sequenz ausgeblendet; Esc im Hinweis schließt nur den Hinweis. Die Mega-Bombe zielt erst ab 30 km Kamerahöhe auf den Globus, darunter wird die Blase wie bei anderen Werkzeugen an den Zielort verlegt (vorher entschied die 5-km-Grenze, und eine knapp darüber gemessene Höhe ließ die Bombe neben der Blase detonieren). E2E prüft Esc und die gesperrten Kameratasten.

**Probleme / bekannt kaputt**

- Die Hülle folgt dem Gelände nicht; außerhalb der Blase verändern Krater und Druckwelle weder Gelände noch Gebäude (ADR-024).
- In Bodennähe nach dem Asteroiden ist die Sicht fast ganz grau (gewollt dunkel, wirkt aber eintönig).
- FPS weiterhin nur mit Software-Rendering gemessen (Mond-Sequenz 5–11 FPS, Pilzwolke in der zerstörten Altstadt 1 FPS).

## 2026-10-05 – M5 Natur & Katastrophen

**Erledigt**

- Wetter: Zustand im Store, sechs Voreinstellungen, Wind nach Stärke und Herkunftsrichtung, Echtwetter von Open-Meteo (Cache 15 min, `weather_code` zusätzlich für Nebel und Gewitter, ADR-023). Darstellung: Wolkendecke (fBm-Shader, windgetrieben), Regen und Schnee als GPU-Partikelvolumen um die Kamera, Nebel nach Sichtweite, Blitze mit Donner, gedämpftes Sonnenlicht, grauer Himmel, Wind- und Regenrauschen.
- Wasser: prozedurale Wellen-Normalmap, Fresnel und Sonnenglanz; Flut in der Blase mit Auftrieb und Wasserwiderstand (Holz schwimmt, Beton sinkt).
- Werkzeuge Stufe 1 (Tageszeit, Wetter, Flut, Schwerkraft) wirken sofort beim Verstellen; dafür gibt es `Tool.onActivate/onParams/onAction` und Knöpfe im Parameter-Panel.
- Werkzeuge Stufe 4: Meteor (Krater nach Collins et al., Leuchtspur, Verfolgerkamera), Tornado (Rankine-Wirbel, wandert, reißt Dächer ab), Erdbeben (Bodenbeschleunigung gegen die Tragfähigkeit je Gebäude), Vulkan (wachsender Kegel als Höhen-Patch, Lava, Aschesäule), Tsunami (Wellen-Mesh und Kraftfeld). Zerstörung um eigene Schadensregeln erweitert (`damage`, `vaporize`).
- Werkzeugleiste zweireihig (23 Werkzeuge), Energieangaben lesbar (kg/t/kt/Mt und MJ/TJ/PJ).
- 260 Unit-Tests (34 neue), E2E um „Echtes Wetter übernehmen“ erweitert. Abnahme in Hamburg und London mit echten Daten, Bilder in `globebox/m5/`:
  - Tornado EF3 durch die Altstadt: 31 Gebäude beschädigt, 51 eingestürzt, rund 1 000 lose Trümmer, Trichter und Schuttwirbel sichtbar.
  - Meteor 50 m bei 20 km/s und 45°: 9,4 Mt TNT (39 PJ), Krater 1 372 m, Blase vollständig ausgelöscht (Barringer-Größenordnung).
  - „Echtes Wetter“ in London: echte Antwort „klar, 0 % Wolken, 3,5 m/s aus WSW“ wird übernommen; mit einer Regen-Antwort (1,4 mm/15 min, 100 % Wolken) stellt die Szene Regen und geschlossene Wolkendecke dar.
- Unabhängiger Test bestanden (Bericht `globebox/m5-test/testbericht.md`). Befunde behoben: „Bewegung reduzieren“ unterdrückt jetzt das Aufhellen durch Gewitterblitze und dämpft Explosionsblitze auf 15 %; der Bilanz-Toast trennt zerstörte von beschädigten Gebäuden; „Gewitter“ hebt den Wind auf mindestens 18 m/s; Toasts liegen unter der Leistungsanzeige; Schwerkraft hat Vorwahlen für Erde, Mond, Mars und Jupiter. Tsunami selbst gegengeprüft (`m5-check.mjs tsunami`, Bilder `m5-tsunami-2/3`): Die Front läuft mit ≈ 27 m/s, reißt Trümmer mit und brachte 10 Gebäude zum Einsturz. 265 Unit-Tests.

**Probleme / bekannt kaputt**

- Ein 50-m-Meteor hinterlässt einen Krater, der größer ist als die Simulationsblase (600 m): Der Krater selbst ist sichtbar, Trümmerphysik gibt es nur in der Blase.
- Das Wasser gibt es nur in der Blase, nicht global auf dem Ellipsoid (Spec 6.3, `SIMPLIFIED`); Gebäude halten das Wasser nicht ab, und beim Verlegen der Blase fällt der Pegel auf 0.
- Partikel und Niederschlag fallen durch Dächer; die Wolkendecke ist eine Ebene, keine Volumenwolken.
- Nach einem Erdbeben in dichter Bebauung entstehen schnell über 1 000 Bruchstücke (je ein Draw-Call); das ist der größte Posten pro Frame.
- FPS weiterhin nur mit Software-Rendering gemessen (1–3 FPS bei voller Zerstörung).

## 2026-10-04 – M4 Explosionen & Zerstörung

**Erledigt**

- Druckwelle (Kinney-Graham), Krater mit Höhen-Patches und eigenem Mesh, Tile-Maske per `onBeforeCompile` nach den Plugins, Zerstörungs-Pipeline mit Vorab-Bruch, Strukturtest und Abschirmung (ADR-022).
- GPU-Partikel und Effekte (Feuerball, Funken, Trümmer, Rauchsäule, Schockwellen-Ring, Staub, Gebäudefeuer), laufen mit der Simulationszeit. Prozeduraler WebAudio-Ton mit Schallverzögerung; Lautstärke und „Ton aus“ in den Einstellungen.
- Werkzeuge Stufe 3: Granate, Fliegerbombe (Verfolgerkamera), Sprengladung (X zündet alle), Rakete. Bilanz-Toast, HUD mit Partikeln und zerstörten Gebäuden.
- 226 Unit-Tests, E2E um die Granate erweitert. Abnahme Hamburg (Rathausmarkt, echte OSM-Daten): 500 kg aus 300 m, Einschlag nach 7,9 s, Krater 9,5 m, 2 eingestürzt und 5 beschädigt, rund 210 lose Trümmer, Rauchsäule. Simulation (Physik, Zerstörung, Partikel) 9–12 ms pro Frame direkt nach dem Einschlag. Die Rauchsäule ist aus der Nähe hinter den Häusern schwach zu sehen. Bilder in `globebox/m4/`.

**Befunde aus dem unabhängigen M4-Test (bestanden, behoben)**

- Mittel: Ein Blasenwechsel leerte die Aufgabenliste, dadurch liefen die Aufräumzweige nie: die Bombe schwebte über der neuen Blase, die Kamera blieb im Verfolgermodus, Ladungen hingen in der Luft. Aufgaben laufen jetzt weiter und erkennen den neuen Frame selbst; die Sprengladung räumt über eine eigene Aufgabe sofort ab. Unit-Test für die Bombe.
- Mittel: Das grobe Physik-Gelände (Mittel: 9,4 m) gab die Kraterschüssel nicht wieder, Kisten sanken am Rand ein. Unter jedem Krater liegt jetzt ein feines Heightfield (0,5 m), das grobe ist dort abgesenkt; `groundY` liest das feine. Unit-Test: Abweichung zur Kraterform unter 15 cm, Kiste liegt auf dem Boden.
- Niedrig: Parameter-Panel über der Werkzeugleiste (verdeckte die Rakete), Toasts unter der Modusleiste, lange Ortsnamen gekürzt (voller Name als Tooltip), Zahlenformat aus dem Sprachkatalog (`t.locale`), die Bilanz zählt auch beschädigte Gebäude, die jetzt einstürzen.

**Probleme / bekannt kaputt**

- „Mittel ≥ 30 FPS“ nur auf echter GPU messbar. Jedes Bruchstück ist ein eigenes Mesh: direkt nach einer 500-kg-Bombe ≈ 500 Draw-Calls.
- Google-Modus (Maskierung der Fotogrammetrie) ohne Key nicht im Browser geprüft; der Shader-Pfad ist derselbe wie für Krater im Open-Data-Modus.
- Proxy-Farben aus OSM statt aus der Fotogrammetrie; Zellen je Stockwerk nicht vom Preset abhängig (ADR-022).
- Wird die Blase verlegt, verschwinden Trümmer und Ladungen; zerstörte Gebäude bleiben ausgeblendet, auch nur beschädigte.
- Die Partikelzahl des Presets gilt erst nach einem Neuladen.

## 2026-10-04 – M3 Physik & Bauen

**Erledigt**

- OSM-Gebäude mit echten Höhen (Overpass, Geohash-6-Zellen, Cache, Multipolygone, `building:part`, Farben, Fensterraster). Berlin-Mitte mit echten Daten geprüft, Screenshots in `globebox/m3/` (ADR-019).
- Rapier lazy (eigener Chunk, 4,3 MB, gzip 1,7 MB), Simulationsblase im eigenen Frame, Heightfield, Gebäude als Trimesh-Collider (ADR-020, ADR-021).
- Werkzeuge Stufe 0 und 2 (10 Stück, `docs/TOOLS.md`), Werkzeugleiste und Parameter aus der Registry. Auto fahrbar (F, W/A/S/D, Leertaste), NPCs wandern und fallen um.
- Body-Budget, Einfrieren schlafender Körper, Despawn außerhalb der Blase. Bodenkamera steht auf Dächern und Objekten.
- M2-Testbefunde behoben: Tastendruck zwischen Frames ging verloren, Fluggeschwindigkeit und -höhe begrenzt, Pause (P), Zeitlupe (T), Leertaste pausiert außer im Bodenmodus und beim Fahren (ADR-018).
- 197 Unit-Tests, 4 E2E. Abnahme in Berlin (Gendarmenmarkt, echte OSM-Daten): 200 Kisten auf einem Dach, alle schlafen auf 12–19 m, Physikschritt 0,2 ms; Auto erreicht 54 km/h nach 9 s und lenkt.

**Befunde aus dem unabhängigen M3-Test (bestanden, behoben)**

- Mittel: Der Physikschritt legte pro Körper neue Objekte an. Rapier-Abfragen schreiben jetzt in Scratch-Objekte, eingefrorene Körper werden übersprungen, Kollisions-Handler und Listen sind wiederverwendet (auch beim Magneten).
- Niedrig: Eingefrorene Körper werden nach der letzten Ruhelage nicht mehr gezeichnet und bleiben statisch in ihrem Instanz-Pool. Ein eigener statischer InstancedMesh fehlt (`SIMPLIFIED`): die Pools sind schon instanziert, ein Umzug brächte erst bei Tausenden Körpern messbar etwas.
- Niedrig: Beim Entfernen eines Autos wird zuerst der Fahrzeug-Controller entfernt, Geometrie und Material werden nach dem Ausblenden freigegeben.
- Niedrig: Nach einer Eingabe im Parameter-Panel geht der Fokus an die Szene zurück (Esc im Feld wählt das Werkzeug ab). E2E prüft das.

**Probleme / bekannt kaputt**

- FPS nur mit Software-Rendering gemessen (4–6 FPS); Abnahme „Mittel > 50 FPS“ muss auf echter GPU erfolgen.
- Flache Dächer (`SIMPLIFIED`), Gebäude noch unzerstörbar (M4). Bodenkamera ohne Character-Controller (ADR-017 für das Gehen).
- Wird die Blase verlegt, verschwinden alle Objekte der alten Blase.
- Der Zielkreis der Blase wird immer gezeichnet, auch wenn kein Werkzeug aktiv ist.

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
