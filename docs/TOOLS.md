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

## Vorlage

### `<tool-id>` – Name (Stufe N)

- **Parameter:** Name (Einheit, Bereich, Standard)
- **Näherung:** Formel und Quelle; was bewusst vereinfacht ist (`SIMPLIFIED`)
- **Grenzen:** was das Werkzeug nicht kann

## Gemeinsame Formeln

- TNT-Äquivalent: 1 kg TNT = 4,184·10⁶ J (`TNT_J_PER_KG` in `src/core/constants.ts`)
- Kinetische Energie (Meteor, M5): E = ½·m·v²
- Druckwelle (`src/physics/blast.ts`): skalierte Distanz Z = R / W^(1/3), Spitzenüberdruck nach Kinney-Graham, ΔP/P₀ = 808·(1 + (Z/4,5)²) / √((1 + (Z/0,048)²)·(1 + (Z/0,32)²)·(1 + (Z/1,35)²)), gekappt bei 2 MPa. Impuls auf Körper ≈ ΔP · Fläche · Dauer der Überdruckphase (0,002 s · W^(1/3)) · Spielfaktor 10, höchstens 60 m/s Δv. Wirkungsradius dort, wo ΔP unter 3 kPa fällt.
- Gebäude: Ein Bruchstück bricht ab 100 kPa Überdruck an seiner nächsten Seite los. Steht ein anderes, nicht eingestürztes Gebäude zwischen Explosion und Stück (Grundriss im Plan, unterhalb seiner Oberkante), wirkt nur 35 % des Drucks (ADR-022).
- Krater (`craterSize`): R = 0,6 · W^(1/3) m, Tiefe 0,4 · R, Wall 0,12 · R bis 2 · R. Luftdetonation in Höhe h: Radius · √k, Tiefe · k mit k = 1 − h / (2 · R), ab h = 2 · R kein Krater. Ab 5 kg TNT.
- Ton: Lautstärke ∝ 1 / (1 + d / (40 m · W^(1/3))), Tiefpass schließt mit der Entfernung, Verzögerung d / 343 m/s.
