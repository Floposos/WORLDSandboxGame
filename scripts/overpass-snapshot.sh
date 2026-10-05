#!/usr/bin/env bash
# Lädt echte OSM-Gebäude (Overpass) für einige Prüforte als JSON-Schnappschuss.
# Nur für Sichtprüfungen in Umgebungen, die Overpass blockieren (Workflow „Overpass snapshot“
# legt das Ergebnis im Branch `ci-snapshots` ab). Kein Test benutzt diese Dateien.
set -euo pipefail
out="${1:-snapshots}"
mkdir -p "$out"
endpoints=(https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter)
# name  süd west nord ost
places=(
  "berlin-mitte 52.5100 13.3700 52.5260 13.4200"
  "tokio-shibuya 35.6530 139.6930 35.6660 139.7080"
  "hamburg-altstadt 53.5450 9.9880 53.5540 10.0040"
)
for p in "${places[@]}"; do
  read -r name s w n e <<<"$p"
  q="[out:json][timeout:60];(way[\"building\"]($s,$w,$n,$e);relation[\"building\"]($s,$w,$n,$e);way[\"building:part\"]($s,$w,$n,$e);relation[\"building:part\"]($s,$w,$n,$e););out geom;"
  for ep in "${endpoints[@]}"; do
    if curl -sS --fail -m 120 -A 'GlobeBox snapshot (github.com/Floposos/WORLDSandboxGame)' \
      --data-urlencode "data=$q" "$ep" -o "$out/$name.json"; then
      echo "$name: $(wc -c <"$out/$name.json") Bytes von $ep"
      break
    fi
    echo "$name: $ep fehlgeschlagen" >&2
    sleep 5
  done
  sleep 3
done
