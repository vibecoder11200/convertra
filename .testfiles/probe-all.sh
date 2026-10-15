#!/usr/bin/env bash
# Headless verification for the conversion pipelines added in
# feat/converters-tier12. Run from the repo root:  bash .testfiles/probe-all.sh
set -e
cd "$(dirname "$0")/.."

echo "== pandoc writers (node, browser_wasi_shim) =="
node .testfiles/pandoc-try.mjs 2>/dev/null

echo
echo "== mupdf document handlers: epub/cbz (node) =="
node .testfiles/mupdf-try.mjs 2>/dev/null

echo
echo "== asHTML output shape (node) =="
node .testfiles/mupdf-html-probe.mjs 2>/dev/null | head -12

echo
echo "== structured markdown builder (bun) =="
bun .testfiles/md-builder-probe.mjs

echo
echo "== SheetJS round-trips (bun web worker) =="
bun .testfiles/sheetjs-probe.mjs | tail -4

echo
echo "== HEIC decode + sniff (bun) =="
bun .testfiles/heic-probe.mjs | tail -3

echo
echo "== converter routing table (node) =="
node .testfiles/routing-sim.mjs | tail -3

echo
echo "== OCR tesseract local assets + accuracy (bun) =="
timeout 240 bun .testfiles/ocr-probe.mjs | tail -4

echo
echo "ALL PROBES DONE"
