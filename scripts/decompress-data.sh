#!/bin/bash
# Decompress gzipped data files for build process

set -e

echo "📦 Decompressing data files..."

DATA_DIR="public/data"

# Check if compressed file exists
if [ ! -f "$DATA_DIR/rs2024-structured.json.gz" ]; then
  echo "❌ Error: $DATA_DIR/rs2024-structured.json.gz not found"
  exit 1
fi

# Decompress if JSON doesn't exist or is older than .gz
if [ ! -f "$DATA_DIR/rs2024-structured.json" ] || [ "$DATA_DIR/rs2024-structured.json.gz" -nt "$DATA_DIR/rs2024-structured.json" ]; then
  echo "🔓 Decompressing rs2024-structured.json.gz..."
  gunzip -k -f "$DATA_DIR/rs2024-structured.json.gz"
  echo "✅ Decompression complete ($(du -h "$DATA_DIR/rs2024-structured.json" | cut -f1))"
else
  echo "✅ rs2024-structured.json already exists and is up to date"
fi

echo "✅ All data files ready"
