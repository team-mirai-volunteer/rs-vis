# 行政事業レビュー サンキー図システム

行政事業レビューシステム（rssystem.go.jp）の予算・支出データをインタラクティブに可視化する Next.js アプリケーション。

対象データは行政事業レビューの対象事業のみ（国の2024年全予算 約556兆円の約27%）です。詳細は [docs/rs-data-scope.md](docs/rs-data-scope.md) を参照してください。

---

## ページ一覧

| ページ | 説明 |
|--------|------|
| `/sankey` | 5列サンキー図（予算総計→府省庁→事業→支出先）、ドリルダウン対応 |
| `/sankey-svg` | SVGベース直接支出サンキー図（2024/2025年度・TopNスライダー・予算/支出フィルタ・会計区分フィルタ・府省庁フィルタ複数選択・ノードPin・ミニマップ・検索・支出先なしノード対応） |
| `/sankey2` | 事前計算レイアウトのCanvas描画サンキー図（Treemapクラスタ配置） |
| `/subcontracts` | 再委託構造ブラウザ（2024/2025年度、カード型フロー図・リスト型サイドパネル） |
| `/quality` | 支出データ品質スコア（5軸評価: 支出先名品質・法人番号・予算乖離等） |
| `/entities` | 支出先エンティティブラウザ（法人番号・NTA照合情報付き） |
| `/entities-v2` | エンティティブラウザ（L1/L2ラベル付き） |
| `/entity-labels-csv` | エンティティラベルCSVダウンロード |
| `/mof-budget-overview` | 財務省（MOF）予算概要ビュー |
| `/globe` | 3D地球儀ビュー |
| `/map` | 地図・回路図・ツリーマップビュー |
| `/budget-drilldown` | 予算ドリルダウンビュー |
| `/spending-bottomup` | 支出先からの逆引きビュー |

---

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router), React 18, TypeScript
- **スタイリング**: Tailwind CSS
- **可視化**: @nivo/sankey, d3系（d3-scale, d3-hierarchy等）, Three.js, @xyflow/react
- **データ処理**: Python 3 (neologdn), TypeScript (tsx)

---

## セットアップ

### 前提条件

- Node.js 18以上
- Python 3.x + `pip3 install neologdn`

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. CSVデータの準備と正規化

[行政事業レビューシステム](https://rssystem.go.jp/download-csv)からZIPファイルをダウンロードし、`data/download/RS_{YEAR}/` に配置してください。

```bash
npm run normalize          # 2024年度
npm run normalize-2025     # 2025年度
```

### 3. データ生成

各ページに必要なデータを生成します。詳細は [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) を参照してください。

```bash
# /sankey 用
npm run generate-structured

# /sankey-svg 用（2024/2025両年度）
npm run generate-sankey-svg
npm run generate-sankey-svg-2025

# /sankey2 用（2024年度固定）
npm run generate-sankey2
npm run compute-sankey2-layout

# /subcontracts 用（2024/2025両年度）
npm run generate-subcontracts
npm run generate-subcontracts-2025

# /quality 用（2024/2025両年度）
npm run score-quality
npm run score-quality-2025

# /entities 用
npm run generate-project-details

# 全データを一括圧縮（Git管理用）
npm run compress-data
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

---

## npm スクリプト

### 開発・ビルド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（Turbopack、ポート3000） |
| `npm run build` | プロダクションビルド（prebuildで.gz自動展開） |
| `npm start` | プロダクションサーバー起動 |
| `npm run lint` | ESLintによるコードチェック |

### データ正規化

| コマンド | 説明 |
|---------|------|
| `npm run normalize` | 2024年度CSV正規化（要: `pip3 install neologdn`） |
| `npm run normalize-2025` | 2025年度CSV正規化 |

### データ生成

| コマンド | 説明 |
|---------|------|
| `npm run generate-structured` | `rs2024-structured.json` 生成（~96MB） |
| `npm run generate-project-details` | `rs2024-project-details.json` 生成 |
| `npm run generate-sankey-svg` | `sankey-svg-2024-graph.json` 生成 |
| `npm run generate-sankey-svg-2025` | `sankey-svg-2025-graph.json` 生成 |
| `npm run generate-sankey2` | `sankey2-graph.json` 生成 |
| `npm run compute-sankey2-layout` | `sankey2-layout.json` 生成 |
| `npm run generate-subcontracts` | `subcontracts-2024.json` 生成 |
| `npm run generate-subcontracts-2025` | `subcontracts-2025.json` 生成 |
| `npm run score-quality` | `project-quality-scores-2024.json` 生成 |
| `npm run score-quality-2025` | `project-quality-scores-2025.json` 生成 |
| `npm run generate-mof-data` | `mof-budget-overview-*.json` 生成 |
| `npm run compress-data` | 全データを gzip 圧縮（Git管理用） |

### 法人番号照合（/entities 用・オプション）

| コマンド | 説明 |
|---------|------|
| `npm run build-houjin-db` | 国税庁ZIPからSQLite構築（初回のみ、約44秒） |
| `npm run build-houjin-lookup` | SQLiteから `houjin-lookup.json` 抽出（約4秒） |

> **注意**: 法人番号データがなくても `/entities` は動作します（NTA照合表示がされないだけ）。
> 取得元: [国税庁法人番号公表サイト](https://www.houjin-bangou.nta.go.jp/download/zenken/index.html)（CSV形式・Unicode）

---

## デプロイ（Vercel）

`main` ブランチへの push → Vercel 自動ビルド（東京リージョン `hnd1`）。

```
git push origin main
```

`prebuild` フックが `.gz` → `.json` を自動展開します。データ更新時は `compress-data` → `.gz` をコミットしてから push してください。

---

## プロジェクト構成

```
.
├── app/                      # Next.js App Router
│   ├── page.tsx              # トップページ（ページ一覧）
│   ├── layout.tsx
│   ├── sankey/               # /sankey メインSankey図
│   ├── sankey-svg/           # /sankey-svg SVGベースSankey図
│   ├── sankey2/              # /sankey2 事前計算Sankey図
│   ├── subcontracts/         # /subcontracts 再委託構造ブラウザ
│   ├── quality/              # /quality 品質スコア
│   ├── entities/             # /entities エンティティブラウザ
│   ├── entities-v2/          # /entities-v2
│   ├── entity-labels-csv/    # /entity-labels-csv
│   ├── mof-budget-overview/  # /mof-budget-overview
│   ├── globe/                # /globe
│   ├── map/                  # /map
│   ├── budget-drilldown/
│   ├── spending-bottomup/
│   ├── api/                  # APIエンドポイント群
│   └── lib/                  # サーバーサイドロジック
├── client/                   # クライアントコンポーネント
│   └── components/
├── scripts/                  # データ生成スクリプト（Python/TypeScript）
├── types/                    # TypeScript 型定義
├── public/data/              # 生成データ（.gz のみ Git 管理）
│   └── dictionaries/         # 支出先名判定辞書（CSV）
├── data/                     # ローカルデータ（.gitignore）
│   ├── download/RS_{YEAR}/   # ZIPダウンロード先
│   └── year_{YEAR}/          # 正規化済みCSV
└── docs/                     # 設計・仕様ドキュメント
```

---

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) | ページ別データパイプライン詳細（必要CSV・生成コマンド） |
| [docs/api-guide.md](docs/api-guide.md) | 全APIエンドポイント仕様 |
| [docs/sankey-architecture-guide.md](docs/sankey-architecture-guide.md) | /sankey 生成ロジック設計 |
| [docs/quality-scoring-guide.md](docs/quality-scoring-guide.md) | 品質スコア5軸評価の詳細 |
| [docs/rs-data-scope.md](docs/rs-data-scope.md) | RSシステム対象データと対象外項目 |
| [docs/構造化JSON仕様書.md](docs/構造化JSON仕様書.md) | rs2024-structured.json のデータ構造 |

---

## データソース

- [行政事業レビューシステム](https://rssystem.go.jp/)（CSVデータ取得元）
- [財務省 予算・決算](https://www.mof.go.jp/policy/budget/)（MOF予算データ）
- [国税庁法人番号公表サイト](https://www.houjin-bangou.nta.go.jp/download/zenken/index.html)（法人番号照合用）

## ライセンス

[GNU Affero General Public License v3.0](LICENSE)
