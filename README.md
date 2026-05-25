# 行政事業レビュー サンキー図システム

行政事業レビューシステム（rssystem.go.jp）の予算・支出データをインタラクティブに可視化する Next.js アプリケーション。

対象データは行政事業レビューの対象事業のみ（国の2024年全予算 約556兆円の約27%）です。詳細は [docs/rs-data-scope.md](docs/rs-data-scope.md) を参照してください。

---

## ページ一覧

トップ `/` は `/sankey-svg` にリダイレクトされます。

| ページ | 説明 |
|--------|------|
| `/sankey-svg` | SVGベース直接支出サンキー図（2024/2025年度切り替え対応） |
| `/subcontracts` | 再委託構造ブラウザ（2024/2025年度、ブロック図・ホバーポップアップ） |
| `/mof-budget-overview` | 財務省（MOF）予算概要ビュー（URL直打ち） |
| `/quality` | 支出データ品質スコア（5軸評価: 支出先名品質・法人番号・予算乖離等、URL直打ち） |

---

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router), React 18, TypeScript
- **スタイリング**: Tailwind CSS
- **可視化**: 自作SVGレイアウト, d3系（d3-scale, d3-hierarchy等）
- **データ処理**: Python 3, TypeScript (tsx)

---

## セットアップ

### 前提条件

- Node.js 18以上
- Python 3.x（品質スコア再生成時のみ）

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。`prebuild` フックで `public/data/*.gz` が `.json` に展開され、即座に動作します。

### データ再生成（任意）

CSVから JSON を再生成する必要がある場合のみ実行します。元 CSV は [行政事業レビューシステム](https://rssystem.go.jp/download-csv) から取得し `data/download/RS_{YEAR}/` に配置してください（`data/` 配下は Git 管理外）。

```bash
npm run generate-sankey-svg          # /sankey-svg 2024
npm run generate-sankey-svg-2025     # /sankey-svg 2025
npm run generate-subcontracts        # /subcontracts 2024
npm run generate-subcontracts-2025   # /subcontracts 2025
npm run generate-mof-data            # /mof-budget-overview
npm run generate-project-details     # /api/project-details
npm run score-quality                # /quality 2024
npm run score-quality-2025           # /quality 2025
npm run compress-data                # gzip 圧縮（Git管理用）
```

---

## npm スクリプト

### 開発・ビルド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（Turbopack、ポート3000） |
| `npm run build` | プロダクションビルド（prebuildで.gz自動展開） |
| `npm start` | プロダクションサーバー起動 |
| `npm run lint` | ESLintによるコードチェック |
| `npm run test:e2e` | Playwright E2Eテスト |
| `npm run test:e2e:ui` | Playwright UIモード |
| `npm run test:e2e:headed` | ブラウザ表示ありでE2Eテスト |
| `npm run test:e2e:report` | Playwright HTMLレポート表示 |

### Playwright E2E

Playwrightはローカルデバッグと画面状態確認用です。E2E用の `data-testid` は通常のproduction buildでは出力せず、Playwright実行時だけ有効化します。

初回のみChromiumをインストールしてください。

```bash
npx playwright install chromium
npm run test:e2e
```

### データ生成

| コマンド | 出力 |
|---------|------|
| `npm run generate-sankey-svg` / `generate-sankey-svg-2025` | `sankey-svg-{2024,2025}-graph.json` |
| `npm run generate-subcontracts` / `generate-subcontracts-2025` | `subcontracts-{2024,2025}.json` |
| `npm run generate-mof-data` | `mof-budget-overview-2023.json` |
| `npm run generate-project-details` | `rs{2024,2025}-project-details.json` |
| `npm run score-quality` / `score-quality-2025` | `project-quality-scores-{2024,2025}.json`, `project-quality-recipients-{2024,2025}.json` |
| `npm run compress-data` | 全データを gzip 圧縮（Git管理用） |

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
│   ├── page.tsx              # トップ（/sankey-svg へリダイレクト）
│   ├── layout.tsx
│   ├── sankey-svg/           # /sankey-svg SVGベースSankey図
│   ├── subcontracts/         # /subcontracts 再委託構造ブラウザ
│   ├── mof-budget-overview/  # /mof-budget-overview
│   ├── quality/              # /quality 品質スコア
│   ├── api/                  # APIエンドポイント群
│   └── lib/                  # サーバーサイドロジック
├── client/                   # クライアントコンポーネント
│   └── components/
├── scripts/                  # データ生成スクリプト（Python/TypeScript）
├── types/                    # TypeScript 型定義
├── public/data/              # 生成データ（.gz のみ Git 管理）
│   └── dictionaries/         # 支出先名判定辞書（CSV）
├── data/                     # ローカルデータ（.gitignore）
│   └── download/RS_{YEAR}/   # ZIPダウンロード先
└── docs/                     # 設計・仕様ドキュメント
```

---

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) | ページ別データパイプライン詳細（必要CSV・生成コマンド） |
| [docs/api-guide.md](docs/api-guide.md) | APIエンドポイント仕様 |
| [docs/quality-scoring-guide.md](docs/quality-scoring-guide.md) | 品質スコア5軸評価の詳細 |
| [docs/rs-data-scope.md](docs/rs-data-scope.md) | RSシステム対象データと対象外項目 |

---

## データソース

- [行政事業レビューシステム](https://rssystem.go.jp/)（CSVデータ取得元）
- [財務省 予算・決算](https://www.mof.go.jp/policy/budget/)（MOF予算データ）
- [国税庁法人番号公表サイト](https://www.houjin-bangou.nta.go.jp/download/zenken/index.html)（法人番号照合用）

## ライセンス

[GNU Affero General Public License v3.0](LICENSE)
