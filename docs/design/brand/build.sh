#!/usr/bin/env bash
# Regenerate Convertra brand assets (Teal palette) from the masters in this folder.
#
# Requirements: ImageMagick 7 (magick) and Google Chrome (headless).
#   CHROME=/path/to/chrome ./build.sh
#
# Masters:
#   icon-app.svg      rounded-square tile, teal bg + white arrows -> favicon.svg/png
#   icon-full.svg     full-bleed square                            -> apple-touch-icon, lettermark.jpg
#   icon-maskable.svg full-bleed, glyph inside PWA safe zone       -> lettermark_maskable.png
#   banner.html       2048x274, transparent rounded corners        -> static/banner.png
#   og.html           1000x500 social preview                      -> src/lib/assets/convertra-feature.webp
#
# Palette: accent #35D4BF (hsl 172 65% 52%, app dark-theme accent) · glyph #0E161B (fg-on-accent) · dark bg #151A1E (hsl 210 18% 10%)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)" # repo root (docs/design/brand -> up 3)
# native paths for Windows binaries (magick.exe can't read /d/... POSIX paths)
ROOT="$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")"
case "$ROOT" in
	[A-Za-z]:/*) FILE_ROOT="file:///$ROOT" ;; # windows drive path
	*) FILE_ROOT="file://$ROOT" ;;
esac
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"

# icons (ImageMagick rasterizes the simple SVGs fine)
magick -background none "$ROOT/docs/design/brand/icon-app.svg" -resize 128x128 PNG32:"$ROOT/static/favicon.png"
magick -background none "$ROOT/docs/design/brand/icon-full.svg" -resize 180x180 PNG32:"$ROOT/static/apple-touch-icon.png"
magick -background none "$ROOT/docs/design/brand/icon-full.svg" -resize 512x512 -quality 92 "$ROOT/static/lettermark.jpg"
magick -background none "$ROOT/docs/design/brand/icon-maskable.svg" -resize 512x512 PNG32:"$ROOT/static/lettermark_maskable.png"
cp "$ROOT/docs/design/brand/icon-app.svg" "$ROOT/static/favicon.svg"

# banner (transparent background so the rounded corners keep alpha)
"$CHROME" --headless=new --disable-gpu --no-first-run --force-device-scale-factor=1 \
	--default-background-color=00000000 --user-data-dir="$(mktemp -d)" \
	--screenshot="$ROOT/docs/design/brand/banner-render.png" --window-size=2048,274 \
	--timeout=12000 "${FILE_ROOT}/docs/design/brand/banner.html"
magick "$ROOT/docs/design/brand/banner-render.png" "$ROOT/static/banner.png"

# OG image -> webp
"$CHROME" --headless=new --disable-gpu --no-first-run --force-device-scale-factor=1 \
	--user-data-dir="$(mktemp -d)" \
	--screenshot="$ROOT/docs/design/brand/og-render.png" --window-size=1000,500 \
	--timeout=12000 "${FILE_ROOT}/docs/design/brand/og.html"
magick "$ROOT/docs/design/brand/og-render.png" -quality 90 "$ROOT/src/lib/assets/convertra-feature.webp"

echo "brand assets regenerated:"
magick identify "$ROOT"/static/favicon.png "$ROOT"/static/apple-touch-icon.png \
	"$ROOT"/static/lettermark.jpg "$ROOT"/static/lettermark_maskable.png \
	"$ROOT"/static/banner.png "$ROOT"/src/lib/assets/convertra-feature.webp
