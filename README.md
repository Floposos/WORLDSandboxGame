# GlobeBox

> **Status: Rohfassung (M0 – Projektgerüst).** Noch kein Globus, nur Gerüst, Game-Loop und FPS-Anzeige.

GlobeBox ist ein Sandbox-Spiel, das komplett im Browser läuft. Du siehst die Erde wie in Google Earth,
zoomst stufenlos vom All bis auf Straßenebene, suchst dir einen echten Ort aus und experimentierst dort:
von Kisten stapeln und Wetter ändern bis zu Meteoriteneinschlägen und Tornados.
Rein fiktiv und spielerisch angenähert, ohne reale Opferdarstellung.

- Läuft **ohne API-Key** im Open-Data-Modus (AWS Terrain Tiles, Sentinel-2 cloudless, OpenStreetMap)
- Optionale Keys (Google Photorealistic 3D Tiles, Cesium ion) schalten bessere Grafik frei
- Statische Seite, gehostet auf GitHub Pages, kein Backend, kein Tracking

## Lokale Entwicklung

Voraussetzung: Node.js 22.12 oder neuer.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Befehl                         | Zweck                                                            |
| ------------------------------ | ---------------------------------------------------------------- |
| `npm run dev`                  | Entwicklungsserver                                               |
| `npm run build`                | Produktions-Build nach `dist/` (Basis-Pfad `/WORLDSandboxGame/`) |
| `npm run preview`              | Build lokal ansehen                                              |
| `npm run typecheck`            | TypeScript (strict) prüfen                                       |
| `npm run lint`                 | ESLint und Prettier prüfen                                       |
| `npm run format`               | Code formatieren                                                 |
| `npm run test`                 | Unit-Tests (Vitest)                                              |
| `npm run test:e2e`             | Smoke-Test im Browser (Playwright, externe APIs gemockt)         |
| `./scripts/check-endpoints.sh` | Externe Datenquellen einmal prüfen                               |

Für die E2E-Tests einmalig `npx playwright install chromium` ausführen.

## Optionale Keys

Kopiere `.env.example` nach `.env.local` und trage deine Keys ein. Alternativ kommen die Keys
später zur Laufzeit über den Einstellungsdialog in den `localStorage` deines Browsers.

**Wichtig:** Keys in einer Browser-App sind für jeden Besucher sichtbar. Beschränke sie deshalb in der
Google-Cloud- bzw. Cesium-Konsole auf deine eigene Domain (HTTP-Referrer). Der GitHub-Pages-Build baut
nie Keys ein. Eine Schritt-für-Schritt-Anleitung folgt mit M8.

## Deployment

Jeder Push auf `main` baut die Seite und veröffentlicht sie über GitHub Pages
(`.github/workflows/deploy.yml`). Einmalig in den Repo-Einstellungen unter
**Settings → Pages → Build and deployment → Source** „GitHub Actions“ auswählen.

## Dokumentation

- [Plan und Meilensteine](docs/PLAN.md)
- [Architektur](docs/ARCHITECTURE.md)
- [Entscheidungen (ADRs)](docs/DECISIONS.md)
- [Werkzeuge](docs/TOOLS.md)
- [Datenquellen und Lizenzen](ATTRIBUTIONS.md)

## Lizenz

Code: [MIT](LICENSE). Die Daten behalten ihre eigenen Lizenzen, siehe [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
