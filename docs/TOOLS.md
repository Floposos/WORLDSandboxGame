# Werkzeuge

> Noch keine Werkzeuge implementiert (ab M3). Jedes Werkzeug bekommt hier einen Abschnitt mit
> Parametern, Formel bzw. Näherung und Grenzen. Grundlage ist Abschnitt 8 des Auftrags.

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
