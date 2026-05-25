#!/bin/bash
# Decompress gzipped data files for build process

set -e

echo "📦 Decompressing data files..."

DATA_DIR="public/data"

decompress_if_needed() {
  local base="$1"
  local required="$2"
  local gz="$DATA_DIR/$base.gz"
  local json="$DATA_DIR/$base"

  if [ ! -f "$gz" ]; then
    if [ "$required" = "required" ]; then
      echo "❌ Error: $gz not found"
      exit 1
    fi
    return 0
  fi

  if [ ! -f "$json" ] || [ "$gz" -nt "$json" ]; then
    echo "🔓 Decompressing $base.gz..."
    gunzip -k -f "$gz"
    echo "✅ Decompression complete ($(du -h "$json" | cut -f1))"
  else
    echo "✅ $base already exists and is up to date"
  fi
}

decompress_if_needed "rs2024-project-details.json" required
decompress_if_needed "rs2025-project-details.json" optional
decompress_if_needed "project-quality-recipients-2024.json" optional
decompress_if_needed "project-quality-recipients-2025.json" optional
decompress_if_needed "sankey-svg-2024-graph.json" optional
decompress_if_needed "sankey-svg-2025-graph.json" optional
decompress_if_needed "subcontracts-2024.json" optional
decompress_if_needed "subcontracts-2025.json" optional

echo "✅ All data files ready"
