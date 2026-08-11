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

# 展開するのは「ブラウザが /data/*.json を直接 fetch する」クライアント配信ファイルのみ。
# サーバ API しか読まないデータ（rs*-project-details / project-quality-recipients /
# recipient-index）は展開しない — ローダが .gz をその場で展開して読む
# （app/lib/api/data-file.ts）。展開すると Vercel の静的配信に 30MB 級 raw が
# 並ぶだけでなく、関数バンドル制御（next.config.ts）の前提も崩れるため展開禁止。
decompress_if_needed "sankey-svg-2024-graph.json" required
decompress_if_needed "sankey-svg-2025-graph.json" optional
decompress_if_needed "subcontracts-2024.json" optional
decompress_if_needed "subcontracts-2025.json" optional
decompress_if_needed "project-quality-scores-2024.json" optional
decompress_if_needed "project-quality-scores-2025.json" optional
decompress_if_needed "rs2025-project-outcomes.json" optional
decompress_if_needed "rs2024-project-outcomes.json" optional
decompress_if_needed "project-map-2025.json" optional
decompress_if_needed "project-map-2024.json" optional

# --- サーバ関数バンドル用データの同期 ---
# Vercel の関数には public/data を一切同梱しない（生 .json 込みだと 250MB 上限を
# 超えるため。next.config.ts の outputFileTracingExcludes 参照）。
# Next の実装上、excludes は includes 適用後に掛かるため、public/data の中身を
# include で残すことはできない。そこで .gz（+ .gz を持たない小容量 mof）だけを
# 別ツリー data/server/ に同期し、そちらを全関数に include する。
# サーバ側ローダは public/data → data/server の順で探索する（app/lib/api/data-file.ts）。
BUNDLE_DIR="data/server"
echo "📦 Syncing server bundle data to $BUNDLE_DIR..."
mkdir -p "$BUNDLE_DIR"
rm -f "$BUNDLE_DIR"/*.json "$BUNDLE_DIR"/*.json.gz
cp "$DATA_DIR"/*.json.gz "$BUNDLE_DIR/"
cp "$DATA_DIR/mof-budget-overview-2023.json" "$BUNDLE_DIR/"
# パイプライン専用の入力はサーバ関数から一切読まないので同梱しない。
# rs{YEAR}-project-outcomes は AI採点スクリプトの入力のみで 8MB 超あり、
# 全関数のバンドルに乗せると 250MB 上限への余裕を無駄に食う。
rm -f "$BUNDLE_DIR"/rs*-project-outcomes.json.gz
echo "✅ Server bundle data ready ($(du -sh "$BUNDLE_DIR" | cut -f1))"

echo "✅ All data files ready"
