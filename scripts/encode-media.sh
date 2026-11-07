#!/usr/bin/env bash
# Re-encode the LinguaSpy trailer and hero loop for the web, and cut posters.
# TODO-V2: when the polished cut lands, run with SRC=C:/GameDevCareer/trailers/linguaspy/v2
#   SRC=/c/GameDevCareer/trailers/linguaspy/v2 scripts/encode-media.sh
# The page reads the output paths from src/data/media.ts, so nothing else changes.
set -euo pipefail
SRC="${SRC:-/c/GameDevCareer/trailers/linguaspy}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/media/linguaspy"
THREADS="${THREADS:-3}"
mkdir -p "$OUT"
# Trailer: 720p30 H.264 + AAC, capped near 4.5 Mbps, faststart so it streams.
ffmpeg -v error -y -i "$SRC/LinguaSpy_trailer.mp4" -vf "scale=1280:-2,fps=30" \
  -c:v libx264 -preset slow -crf 22 -maxrate 4500k -bufsize 9000k -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart -threads "$THREADS" "$OUT/linguaspy-trailer.mp4"
# Hero loop: 960 wide, muted, 30 fps.
ffmpeg -v error -y -i "$SRC/LinguaSpy_hero_loop.mp4" -an -vf "scale=960:-2,fps=30" \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -threads "$THREADS" "$OUT/linguaspy-loop.mp4"
ls -la "$OUT"
