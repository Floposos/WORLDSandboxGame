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

## Vorlage

### `<tool-id>` – Name (Stufe N)

- **Parameter:** Name (Einheit, Bereich, Standard)
- **Näherung:** Formel und Quelle; was bewusst vereinfacht ist (`SIMPLIFIED`)
- **Grenzen:** was das Werkzeug nicht kann

## Gemeinsame Formeln (geplant)

- TNT-Äquivalent: 1 kg TNT = 4,184·10⁶ J (`TNT_J_PER_KG` in `src/core/constants.ts`)
- Kinetische Energie (Meteor): E = ½·m·v²
- Druckwelle: skalierte Distanz Z = R / W^(1/3), Spitzenüberdruck nach Kinney-Graham, gekappt und auf Spielwerte gemappt (M4)
- Krater: monotone, vereinfachte Skalierung aus der Einschlagsenergie (M4)
