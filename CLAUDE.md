# Hinweise für Claude

**Kalter Start? Lies zuerst [docs/PROGRESS.md](docs/PROGRESS.md)** (aktueller Stand und nächster Schritt).
Durchsuche nicht die Session-Historie; alles Nötige steht in diesen Dateien:

| Datei                  | Wofür                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/PROGRESS.md`     | Stand, nächster Schritt, offene Probleme. Bei jedem nennenswerten Schritt aktualisieren und mitcommitten. Knapp halten. |
| `docs/PLAN.md`         | Meilensteine M0–M8 mit Häkchen, Endpunkt- und Bibliotheksprüfung, Annahmen, Risiken                                     |
| `docs/SPEC.md`         | **Verbindliche Spezifikation** (Florians Originalauftrag, wortgetreu). Im Zweifel gilt sie. Nicht ändern.               |
| `docs/DECISIONS.md`    | ADRs: wo und warum vom Auftrag abgewichen oder etwas entschieden wurde                                                  |
| `docs/ARCHITECTURE.md` | Module, Koordinatensysteme (ENU: x=Ost, y=Oben, z=−Nord), Loop, Provider-Kette                                          |

## Arbeitsregeln

- Unabhängiger Test: Nach jedem Meilenstein (PR steht, eigene Checks grün) nennt die Zusammenfassung den PR-Link und eine kurze Prüfliste für einen separaten Test-Agenten. Dieser checkt den Branch unabhängig aus, führt typecheck/lint/test/build aus, prüft die App im Browser und meldet Befunde zurück. Befunde vor dem „weiter“ beheben.
- Strikt meilensteinweise. Nach jedem Meilenstein: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` grün, App im Browser prüfen (Screenshot), PLAN.md und PROGRESS.md aktualisieren, committen (`feat(Mx): …`), kurz berichten und auf Florians „weiter“ warten.
- API-Doku nie aus dem Gedächtnis: `node_modules/<pkg>/README.md` und Typdefinitionen lesen, Versionen exakt pinnen.
- Wenn der Context7-Connector in der Session verfügbar ist, damit aktuelle Doku (three, 3d-tiles-renderer, Rapier …) vor API-Nutzung nachschlagen, zusätzlich zu `node_modules`. Jeder Aufruf fragt Florian um Freigabe: Anfragen bündeln, sparsam einsetzen.
- Keine Keys im Repo. Kein Test spricht echte externe APIs an.
- Vereinfachungen mit `// SIMPLIFIED:` markieren.
- UI-Texte nur in `src/ui/i18n/de.ts` (+ `en.ts`).
- Modelle effizient nutzen: Routinearbeit (Endpunkt-Checks per curl, Doku lesen, mechanische Gerüste) an günstigere Subagenten delegieren, Architektur und Kernlogik selbst machen, große Kontexte vermeiden.

## Umgebung

- Node 22 (`.nvmrc`). Lokale E2E in Sandboxen mit vorinstalliertem Chromium: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`.
- Neue Cloud-Umgebung (ab 2026-10-04) erreicht die Datenhosts außer Overpass; `scripts/check-endpoints.sh` prüft das (auch im Workflow „Endpoint check“). Sichtprüfung mit echten Daten: `npm run dev` und `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshot-live.mjs <Ort> <Ordner>`.
