#!/usr/bin/env bash
# Prüft alle externen Endpunkte aus der Spezifikation (Abschnitt 5) einmal.
# Läuft manuell, wöchentlich in GitHub Actions und nie in Unit-/E2E-Tests.
# Keine Keys nötig. Exit-Code 1, wenn ein Pflicht-Endpunkt ausfällt.
set -u
UA="GlobeBox-endpoint-check/0.1 (+https://github.com/Floposos/WORLDSandboxGame)"
fail=0

check() { # name required(0/1) url [expected-content-type-substring]
  local name="$1" required="$2" url="$3" want="${4:-}"
  local out code ctype
  out=$(curl -sS -L -o /dev/null -m 30 -A "$UA" -w '%{http_code} %{content_type}' "$url" 2>&1) || true
  code=${out%% *}
  ctype=${out#* }
  local ok=0
  [[ "$code" =~ ^2 ]] && { [[ -z "$want" || "$ctype" == *"$want"* ]] && ok=1; }
  if [[ $ok == 1 ]]; then
    printf '✅ %-34s %s %s\n' "$name" "$code" "$ctype"
  else
    printf '❌ %-34s %s\n' "$name" "$out"
    [[ "$required" == 1 ]] && fail=1
  fi
  sleep 1 # höflich bleiben (Nominatim: max. 1 req/s)
}

check "AWS Terrain Tiles (Terrarium)" 1 "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/0/0/0.png" image/png
check "EOX WMTS Capabilities" 1 "https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml" xml
check "EOX s2cloudless 2016 (3857)" 1 "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/2/1/2.jpg" image
check "EOX s2cloudless 2024 (3857)" 0 "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/2/1/2.jpg" image
check "NASA GIBS Blue Marble (3857)" 1 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/2/1/1.jpeg" image
check "NASA GIBS Black Marble (3857)" 0 "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/2/1/1.png" image
check "Overpass (overpass-api.de)" 1 "https://overpass-api.de/api/status"
check "Overpass Mirror (private.coffee)" 0 "https://overpass.private.coffee/api/status"
check "Photon Suche" 1 "https://photon.komoot.io/api/?q=Zugspitze&limit=1" json
check "Photon Reverse" 1 "https://photon.komoot.io/reverse?lat=47.4211&lon=10.9853" json
check "Nominatim Suche" 0 "https://nominatim.openstreetmap.org/search?format=jsonv2&q=Zugspitze&limit=1" json
check "Open-Meteo Forecast" 1 "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current=temperature_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,is_day" json

# Google ohne Key: 400/403 heißt "Endpunkt lebt, Key fehlt" – das ist hier das erwartete Ergebnis.
g=$(curl -sS -o /dev/null -m 30 -w '%{http_code}' "https://tile.googleapis.com/v1/3dtiles/root.json?key=INVALID" 2>&1 || true)
if [[ "$g" == 400 || "$g" == 403 ]]; then echo "✅ Google 3D Tiles (ohne Key)          $g (erwartet: Key ungültig)"; else echo "⚠️  Google 3D Tiles (ohne Key)          $g"; fi
c=$(curl -sS -o /dev/null -m 30 -w '%{http_code}' "https://api.cesium.com/v1/assets/1/endpoint" 2>&1 || true)
if [[ "$c" == 401 ]]; then echo "✅ Cesium ion (ohne Token)             $c (erwartet: Token fehlt)"; else echo "⚠️  Cesium ion (ohne Token)             $c"; fi

exit $fail
