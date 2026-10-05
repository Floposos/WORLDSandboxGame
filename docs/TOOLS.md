# Werkzeuge

> Grundlage ist Abschnitt 8 des Auftrags. Alle Werkzeuge implementieren `Tool` aus
> `src/tools/Tool.ts`, je eine Datei in `src/tools/tierN/`, registriert in `src/tools/index.ts`.
> Die Werkzeugleiste entsteht vollständig aus der Registry. Werkzeuge wirken unter 5 km Kamerahöhe;
> liegt das Ziel außerhalb der Simulationsblase, wird sie dorthin verlegt (ADR-020).

## Stufe 0 – Bauen

### `place-box` – Kiste

- **Parameter:** Kantenlänge (m, 0,5–5, 1), Material (Holz 600 / Beton 2 400 / Metall 7 800 kg/m³), Anzahl (1–200, 1)
- **Näherung:** Würfel-Collider mit Dichte, Reibung und Rückprall des Materials. Ab 2 Stück ein Stapel (bis 5 × 5 je Lage), der aus 3 m Höhe fällt.
- **Grenzen:** Budget je Preset (Mittel 1 000 Körper); darüber verschwinden die ältesten.

### `place-ball` – Kugel

- **Parameter:** Radius (m, 0,2–3, 0,5), Material (Gummi, Holz, Beton, Metall)
- **Näherung:** Kugel-Collider, Gummi mit Rückprall 0,75.

### `place-car` – Auto

- **Parameter:** Sofort einsteigen (ja)
- **Näherung:** Kastenchassis 1,8 × 0,7 × 4,4 m, 1 200 kg, Rapier `DynamicRayCastVehicleController` mit 4 Rädern, Hinterradantrieb (2 400 N je Rad), Lenkwinkel bis 0,5 rad, bei Tempo kleiner. Steuerung W/S, A/D, Leertaste bremst, F steigt in das nächste Auto bis 30 m ein bzw. aus. Kamera: Verfolgerkamera hinter dem Auto.
- **Grenzen:** `SIMPLIFIED`: kein Getriebe, kein Schaden.

### `place-npcs` – Menschen

- **Parameter:** Anzahl (1–200, 20)
- **Näherung:** Kapseln (≈ 75 kg) mit gesperrter Rotation, wandern mit 1,3 m/s und ändern alle 2–6 s die Richtung. Ein Stoß über 3,5 m/s lässt sie umfallen (Rotation frei).
- **Grenzen:** Keine Wegfindung; abstrakt, ohne Opferzahlen.

### `place-wall` – Mauer

- **Parameter:** Höhe (m, 0,5–6, 2), Material
- **Näherung:** Zwei Klicks (Start, Ende, bis 40 m). Blöcke 1 × 0,5 × 0,5 m im versetzten Verband, schlafend erzeugt, damit die Mauer steht, bis etwas sie trifft.

### `eraser` – Radierer

- **Parameter:** Radius (m, 0–20, 0)
- **Näherung:** Entfernt den getroffenen Körper bzw. alle Körper im Radius (mit Ausblenden).

## Stufe 2 – Physik

### `throw` – Werfen

- **Parameter:** Geschwindigkeit (m/s, 5–80, 25), Objekt (Kiste/Kugel), Größe (m, 0,3–3, 0,8)
- **Näherung:** Start 2 m vor der Kamera, Anfangsgeschwindigkeit entlang des Klickstrahls.

### `wrecking-ball` – Abrissbirne

- **Parameter:** Masse (kg, 500–5 000, 2 000), Seillänge (m, 5–30, 12)
- **Näherung:** Kranpunkt eine Seillänge über dem Ziel, Stahlkugel (r = ∛(3m / 4πρ)) 60° zur Kamera ausgelenkt, Rapier-Seilgelenk; sie schwingt durch den Klickpunkt.
- **Grenzen:** Kranpunkt ist unsichtbar und fest; Gebäude sind bis M4 unzerstörbar.

### `force-push` – Kraftstoß

- **Parameter:** Stärke (Δv in m/s, 1–50, 15), Reichweite (m, 5–150, 60)
- **Näherung:** Kegel mit 25° halbem Öffnungswinkel von der Kamera. Δv = Stärke · (1 − d/R) · (1 − 0,5 · Winkel/25°), leicht nach oben gerichtet, als Impuls m · Δv.

### `magnet` – Magnet

- **Parameter:** Stärke (g, 0,5–10, 2), Radius (m, 5–60, 25)
- **Näherung:** Magnet 4 m über dem Klickpunkt, Beschleunigung a = Stärke · g · (1 − d/R), im innersten Meter gedämpft. Wirkt im festen 60-Hz-Schritt. Zweiter Klick nahe dem Magneten schaltet ihn ab.

## Stufe 1 – Natur

Diese Werkzeuge wirken sofort beim Verstellen der Regler, auch ohne Klick ins Bild (`Tool.onParams`).
`flood` und `gravity` brauchen die Simulationsblase: Ein Klick ins Gelände legt sie an.

### `time-of-day` – Tageszeit

- **Parameter:** Uhrzeit (h, 0–23,75 in Viertelstunden, 12), Tag (1–31, 21), Monat (Auswahl, Juni)
- **Näherung:** Die Uhrzeit ist die mittlere Sonnenzeit am Längengrad der Blase bzw. unter der Kamera (UTC + λ/15 h), 12 Uhr steht die Sonne also im Süden. Der Sonnenstand selbst kommt aus dem NOAA-Algorithmus (`world/atmosphere/sun.ts`), nicht aus einer API. Der Regler schreibt `store.simTime`, derselbe Wert wie im Zeitregler oben rechts.
- **Grenzen:** `SIMPLIFIED`: keine Zeitgleichung und keine echten Zeitzonen (bis zu ±16 min bzw. ±30 min Abweichung zur Ortszeit).

### `weather` – Wetter

- **Parameter:** Wetterlage (klar/bewölkt/Regen/Schnee/Gewitter/Nebel, klar), Windstärke (m/s, 0–40, 3), Wind aus (°, 0–350, 250), Knopf „Echtes Wetter übernehmen“
- **Näherung:** Die Wetterlage setzt Bewölkung, Niederschlag und Stärke. Der Wind ist meteorologisch angegeben (Richtung, aus der er kommt) und treibt Wolken, Regen, Schnee, Rauch und Staub. Darstellung: Wolkendecke 1 800 m über Grund (fBm-Rauschen im Shader), Regen und Schnee als Partikelvolumen um die Kamera (70 × 45 × 70 m, Bewegung komplett im Vertex-Shader), Nebel über die Sichtweite (klar 80 km, Regen 3–9 km, Nebel 220 m), Blitze mit Donner bei Gewitter, gedämpftes Sonnenlicht (bis 12 %) und grauer Himmel. Ton: Wind- und Regenrauschen.
- **Echtwetter:** Open-Meteo `current=temperature_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,is_day,weather_code` in m/s, Cache 15 min je 0,1°-Punkt (ADR-023). Die Niederschlagsmenge des Intervalls wird in mm/h umgerechnet, 8 mm/h entsprechen voller Stärke; der WMO-Code unterscheidet Nebel (45/48) und Gewitter (ab 95).
- **Grenzen:** `SIMPLIFIED`: keine Wolkenschatten, kein Niederschlag unter Dächern, die Wolkendecke ist eine Ebene statt Volumen.

### `flood` – Flut

- **Parameter:** Wasserstand (m über dem tiefsten Punkt der Blase, 0–50, 8)
- **Näherung:** Eine runde Wasserfläche im Blasenradius steigt mit 2 m/s auf den Zielwert; das Gelände verdeckt sie (Tiefentest). Körper darunter bekommen Auftrieb (ρ·g·V_eingetaucht, ρ = 1 000 kg/m³) und Wasserwiderstand: Holz und Trümmer schwimmen auf, Beton und Metall sinken.
- **Grenzen:** `SIMPLIFIED` (Spec 6.3): ein waagerechter Spiegel ohne Strömung, nur in der Blase; Gebäude halten das Wasser nicht ab. Beim Verlegen der Blase fällt der Pegel auf 0.

### `gravity` – Schwerkraft

- **Parameter:** Schwerkraft (g, 0–3 in Schritten von 0,05, 1)
- **Näherung:** Faktor auf die Erdbeschleunigung der ganzen Blase (`PhysicsWorld.gravityScale`). Schlafende und eingefrorene Körper werden geweckt, damit die Änderung sofort wirkt; der Wert bleibt auch nach dem Abwählen bestehen.
- **Grenzen:** Wirkt nur in der Blase, nicht auf Kamera oder Partikel.

## Stufe 3 – Explosionen

Alle Explosionen laufen über `ExplosionService.detonate` (`src/tools/explosions.ts`): Druckwelle auf Körper
und Gebäude, Krater ab 5 kg am Boden, Effekte, Ton, Bildschirmwackeln, Ereignis `explosion` und ein
Bilanz-Toast (TNT, Energie in MJ, Kraterdurchmesser, beschädigte Gebäude; keine Opferzahlen).

### `grenade` – Granate

- **Parameter:** Ladung (kg TNT, 0,2–2, 0,5), Zünder (s, 1–6, 3), Wurfgeschwindigkeit (m/s, 5–35, 16)
- **Näherung:** Rapier-Kugel (r = 6 cm, ≈ 0,45 kg, CCD) aus der Kamera, leicht nach oben geworfen; nach Ablauf des Zünders Explosion an der aktuellen Position, Höhe über Grund als Luftdetonation.
- **Grenzen:** Ist die Kamera weiter als 40 m entfernt, startet die Granate 20 m vor dem Ziel (`SIMPLIFIED`).

### `aerial-bomb` – Fliegerbombe

- **Parameter:** Sprengkraft (kg TNT, 50–1 000, 500), Abwurfhöhe (m, 100–3 000, 600), Kamera folgt (an)
- **Näherung:** Senkrechter Fall ohne Luftwiderstand, t = √(2h/g) (`SIMPLIFIED`); 600 m ≈ 11 s. Die Bombe durchschlägt Dächer und zündet am Boden unter dem Treffpunkt (Verzögerungszünder). Die Verfolgerkamera hängt sich an, bleibt nach dem Einschlag 4 s auf der Stelle und kehrt dann zur vorherigen Ansicht zurück.
- **Grenzen:** Bombenmasse = TNT-Äquivalent; kein Abprallen, keine Schräglage.

### `demolition-charge` – Sprengladung

- **Parameter:** Ladung (kg TNT, 0,5–50, 5)
- **Näherung:** Klick heftet eine Ladung an die getroffene Fläche (höchstens 24). **X** zündet alle gleichzeitig, auch wenn danach ein anderes Werkzeug gewählt ist; eine gemeinsame Bilanz.
- **Grenzen:** Ladungen bleiben an ihrer Stelle, auch wenn das Bruchstück darunter fällt. Eine neue Blase verwirft sie.

### `rocket` – Rakete

- **Parameter:** Gefechtskopf (kg TNT, 1–25, 4), Geschwindigkeit (m/s, 50–300, 140)
- **Näherung:** Geradlinig von der Kamera (höchstens 600 m Flugweg) zum Ziel mit Rauchschweif, Explosion 0,3 m vor der getroffenen Fläche.
- **Grenzen:** Keine Ballistik, keine Kollision unterwegs (`SIMPLIFIED`).

## Stufe 4 – Katastrophen

### `meteor` – Meteor

- **Parameter:** Durchmesser (m, 1–100, 20), Geschwindigkeit (km/s, 11–72, 20), Eintrittswinkel (°, 15–90, 45), Kamera folgt (ja)
- **Näherung:** Steinmeteor mit 3 000 kg/m³, E = ½·m·v², Umrechnung in TNT. Krater nach Collins, Melosh & Marcus (2005): transienter Krater D_tc = 1,161 · (ρ_i/ρ_t)^(1/3) · L^0,78 · v^0,44 · g^(−0,22) · sin^(1/3)θ, Endkrater D = 1,25 · D_tc, Tiefe 0,2 · D, Wall 0,07 · D_tc⁴/D³. Die Druckwelle läuft über denselben Dienst wie die Bomben. Leuchtspur aus Partikeln, Feuerkugel und Plasmaschweif; die Verfolgerkamera hängt sich an und zieht sich nach dem Einschlag zurück.
- **Grenzen:** `SIMPLIFIED` (ADR-023): Anflug auf 4,5 s gestreckt, kein Abbremsen oder Zerplatzen in der Atmosphäre (kleine Steine würden real in der Luft explodieren). Gebäude im Krater und über 1 MPa Überdruck verschwinden ohne Bruchstücke, außerhalb brechen höchstens 40 Gebäude in Stücke. 50 m bei 20 km/s ergeben 9,4 Mt und einen Krater von 1,4 km – größer als die Blase.

### `tornado` – Tornado

- **Parameter:** Stärke (EF0–EF5, EF3), Kernradius (m, 20–150, 50), Zugbahn (zufällig oder von Klick zu Klick), Dauer (s, 15–120, 60)
- **Näherung:** Rankine-Wirbel: tangential v = v_max · r/R innen und v_max · R/r außen, dazu radiales Einströmen (55 %, am Boden stärker) und Aufwind im Kern bis 220 m Höhe, darüber nach außen. Die Stufen entsprechen den EF-Windgeschwindigkeiten (EF3 = 68 m/s). Auf Körper wirkt der Luftwiderstand ½·ρ·c_w·A·Δv² mit Spielfaktor 3, höchstens 45 m/s². Der Trichter zieht mit 12 m/s über das Gelände.
- **Gebäude:** Ein Bruchstück reißt los, wenn der Wind an seiner Stelle über seiner Haltegrenze liegt: Dach ab 40 m/s, Erdgeschoss erst ab 95 m/s (ADR-023). Pro Prüfung (alle 0,2 s) brechen höchstens 3 Gebäude neu auf.
- **Grenzen:** `SIMPLIFIED`: kein Unterdruck, keine Mehrfachwirbel, keine Schäden an Gelände oder Bäumen.

### `earthquake` – Erdbeben

- **Parameter:** Stärke (1–10 in halben Stufen, 6), Dauer (s, 5–60, 20)
- **Näherung:** Spielerische Skala: Spitzenbeschleunigung a = 0,002 g · 10^(0,45·(M−1)), höchstens 3 g, mit der Entfernung abnehmend (Stärke 5 ≈ 0,13 g, 7 ≈ 1 g). Der Boden schwingt mit 1,4 und 2,3 Hz quer zueinander und schwächer senkrecht; Körper mit Bodenkontakt bekommen die passenden Impulse, Kamera und Bild wackeln. Verlauf: 2 s Anstieg, Plateau, letztes Drittel Abklingen.
- **Gebäude:** Tragfähigkeit je Gebäude = Bauqualität (fest aus der OSM-ID, 0,25–1) · 1,3 / (1 + Höhe/40 m), also 0,13 bis 1,35 g. Liegt die Beschleunigung darüber, lösen sich Stücke, das Erdgeschoss zuerst; darüber liegende Stockwerke fallen nach.
- **Grenzen:** `SIMPLIFIED`: keine Wellenausbreitung, keine Resonanz nach Bauhöhe, keine Bodenverflüssigung, kein Versatz im Gelände.

### `volcano` – Vulkan

- **Parameter:** Höhe (m, 20–300, 120), Ausbruchsdauer (s, 30–180, 90)
- **Näherung:** Der Kegel ist ein Höhen-Patch wie ein Krater, nur umgekehrt: H · (1 − r/R)^1,4 mit Basisradius R = 2,4 · H (≈ 23° Flanken) und einem Gipfelkrater (12 % von R, 0,35 · R_c tief). Er wächst in 20 s, das Physik-Gelände wird dabei alle 1,5 s neu gebaut. Lavafontäne (glühende Partikel, ballistisch, 25–55 m/s), Aschesäule mit Wind, Rumpeln und leichtes Beben.
- **Grenzen:** `SIMPLIFIED`: keine fließende Lava, keine Lavabomben als Körper, kein Einsturz des Kegels. Gebäude unter den Flanken werden verschüttet (verschwinden ohne Trümmer).

### `tsunami` – Tsunami

- **Parameter:** Wellenhöhe (m, 3–30, 12)
- **Näherung:** Die Welle startet am tiefsten Rand der Blase (dort liegt das Wasser) und läuft zum Klickpunkt. Geschwindigkeit 2,2 · √(g·h) (12 m ≈ 24 m/s), Profil mit steiler Front (0,5 · H voraus) und langem Rücken (8 · H). Körper im Wasserkörper werden mit der Strömung mitgerissen und angehoben; Gebäude verlieren an der Front die unteren Stücke. Nach dem Durchlauf bleibt Wasser stehen und läuft ab.
- **Grenzen:** `SIMPLIFIED` (Spec 8): Wasserwand-Mesh plus Kraftfeld, keine Strömungssimulation; die Welle läuft geradeaus und bricht sich nicht am Gelände.

## Vorlage

### `<tool-id>` – Name (Stufe N)

- **Parameter:** Name (Einheit, Bereich, Standard)
- **Näherung:** Formel und Quelle; was bewusst vereinfacht ist (`SIMPLIFIED`)
- **Grenzen:** was das Werkzeug nicht kann

## Gemeinsame Formeln

- TNT-Äquivalent: 1 kg TNT = 4,184·10⁶ J (`TNT_J_PER_KG` in `src/core/constants.ts`)
- Kinetische Energie (Meteor): E = ½·m·v², Masse aus Kugelvolumen und 3 000 kg/m³
- Einschlagkrater (`src/physics/impact.ts`): Collins, Melosh & Marcus (2005), siehe `meteor`
- Wirbel (`src/physics/vortex.ts`): Rankine-Profil, Luftwiderstand ½·ρ·c_w·A·Δv²
- Auftrieb (`src/world/water/water.ts`): F = ρ_Wasser · g · V_eingetaucht, ρ = 1 000 kg/m³
- Druckwelle (`src/physics/blast.ts`): skalierte Distanz Z = R / W^(1/3), Spitzenüberdruck nach Kinney-Graham, ΔP/P₀ = 808·(1 + (Z/4,5)²) / √((1 + (Z/0,048)²)·(1 + (Z/0,32)²)·(1 + (Z/1,35)²)), gekappt bei 2 MPa. Impuls auf Körper ≈ ΔP · Fläche · Dauer der Überdruckphase (0,002 s · W^(1/3)) · Spielfaktor 10, höchstens 60 m/s Δv. Wirkungsradius dort, wo ΔP unter 3 kPa fällt.
- Gebäude: Ein Bruchstück bricht ab 100 kPa Überdruck an seiner nächsten Seite los. Steht ein anderes, nicht eingestürztes Gebäude zwischen Explosion und Stück (Grundriss im Plan, unterhalb seiner Oberkante), wirkt nur 35 % des Drucks (ADR-022).
- Krater (`craterSize`): R = 0,6 · W^(1/3) m, Tiefe 0,4 · R, Wall 0,12 · R bis 2 · R. Luftdetonation in Höhe h: Radius · √k, Tiefe · k mit k = 1 − h / (2 · R), ab h = 2 · R kein Krater. Ab 5 kg TNT.
- Ton: Lautstärke ∝ 1 / (1 + d / (40 m · W^(1/3))), Tiefpass schließt mit der Entfernung, Verzögerung d / 343 m/s.
