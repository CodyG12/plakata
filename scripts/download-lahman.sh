#!/usr/bin/env bash
# Downloads the subset of the SABR Lahman Baseball Database (1871–2025, released
# Dec 10, 2025) that the game needs. Source: https://sabr.org/lahman-database/
# License: CC BY-SA 3.0 — see readme2025.txt in the download.
#
# Usage: scripts/download-lahman.sh <output-dir>
set -euo pipefail

OUT="${1:?usage: download-lahman.sh <output-dir>}"
mkdir -p "$OUT"

SHARE="y1prhc795jk8zvmelfd3jq7tl389y6cd"
BASE="https://sabr.box.com/index.php?rm=box_download_shared_file&shared_name=${SHARE}&file_id="

download() {
  echo "Downloading $1"
  curl -fsSL -A "Mozilla/5.0" -o "$OUT/$1" "${BASE}$2"
}

download readme2025.txt     f_2084259918153
download People.csv         f_2084263017537
download Batting.csv        f_2084272468053
download Appearances.csv    f_2084267195632
download AwardsPlayers.csv  f_2084273346810
download HallOfFame.csv     f_2084268925644
download Teams.csv          f_2084266946255

echo "Done. Now run: npm run build:data -- $OUT"
