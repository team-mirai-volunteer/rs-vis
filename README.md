# 政府予算見える化（旧称: 行政事業レビュー可視化）

行政事業レビューシステム（rssystem.go.jp）の予算・支出データを中心に、国の予算の流れ・事業の評価・委託構造・基金・事業者・概算要求・税制・家計負担・財政余力をブラウザで見られるようにする Next.js アプリケーション。本番は https://rs-vis.team-mir.ai で公開しています。

対象の中心は行政事業レビュー（RS）の対象事業です（国の全予算の約 27%）。範囲と対象外は [docs/rs-data-scope.md](docs/rs-data-scope.md) を参照してください。RS のシート年度 N には N−1 年度の執行・支出先が載ります（2025 年版 = 2024 年度実績）。

---

## ページ一覧

トップ `/` は各ビューへの入口です。ヘッダーの「AI」からどのページでも AI ナビ（自然言語での絞り込み・データの問い合わせ・ページ移動）を使えます。

### 主なビュー

| ページ | 説明 |
|--------|------|
| `/budget-sankey` | サンキー図。歳入→会計→所管→項→目→事業→支出先の流れを 1 本で追う。所管・名前・金額・再委託・政策評価スコア（6 項目）・継続年数で絞り込み。「RSのみ」プリセットが旧 `/sankey-svg`（旧 URL はここへリダイレクト） |
| `/project-bubble` | バブルチャート。5,000 超の事業を内容の近さで配置し、予算規模や AI 評価を切り替えて比較 |
| `/quality` | 評価一覧。公開資料に基づく独自基準の AI 評価（試行）と執行透明性スコアを事業ごとに一覧。詳細ダイアログに予算・執行推移、支出先、みんなの意見 |
| `/subcontracts` | 委託構造。事業ごとの支出先・再委託先の構造を図と表で確認（契約方式・再委託率・クイックフィルタ） |
| `/vendors` | 事業者別。事業者（法人番号）ごとの受注額・1 者応札率・随意契約 |
| `/funds` | 基金。基金シートから残高・支出・国庫返納・終了予定・点検結果 |

### 補助ビュー（試作）

| ページ | 説明 |
|--------|------|
| `/budget-requests` | 2027 年度の概算要求・要望を原資料とともに探す |
| `/tax-expenditures` | 法人税の租税特別措置の適用実態と関連 RS 事業、AI による試行評価 |
| `/tax-burden` | 年収・家族構成別の税と保険料の負担率、国の税目別歳入（2025 年度制度のモデル計算） |
| `/fiscal-space` | 財政余力シミュレータ。政策・物価・労働・エネルギー・国債借換を仮定モデルで条件比較 |

### 財務省予算書（URL 直打ち）

`/mof-budget-overview`（予算全体）、`/mof-jikou`（事項）、`/mof-kou-moku`（科目別内訳）、`/mof-kou`（項一覧）、`/mof-hierarchy`（階層フロー）、`/mof-sankey`（項×RS 事業）。

### その他

`/lp`（紹介ページ）、`/terms`（利用規約）、`/privacy`（プライバシーポリシー）。

---

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router, Turbopack), React 18, TypeScript
- **スタイリング**: Tailwind CSS、lucide-react
- **可視化**: 自作 SVG レイアウト、d3 系、Canvas（バブルチャート）、Web Worker（財政余力の計算）
- **データ**: 生成済み JSON を `.gz` で Git 管理し、ビルド時に展開。意見投稿と AI ナビの対話ログは Supabase
- **AI**: OpenRouter 経由の LLM。訪問者の API キー（BYOK・ブラウザ直）を優先し、環境変数があればサイト提供 AI
- **データ処理**: Python 3、TypeScript (tsx)
- **テスト**: Node.js test runner（単体）、Playwright（E2E）

---

## セットアップ

### 前提条件

- Node.js 22 以上（CI と同じ）
- Python 3.x（データ再生成時のみ）

### 起動

```bash
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。`prebuild` フックで `public/data/*.gz` が `.json` に展開され、データ生成なしで動きます。

### 任意の環境変数

| 変数 | 用途 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 事業への意見投稿（AI インタビュー）と AI ナビの対話ログ保存。無ければ API は 404、UI は非表示 |
| `SANKEY_AI_CHAT_ENABLED=1` と OpenRouter のキー | サイト提供 AI（キー未登録の訪問者も AI ナビを使える）。モデルは `SANKEY_AI_CHAT_MODEL` / `SANKEY_AI_INTERVIEW_MODEL` で差し替え |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics 4 の測定 ID（本番環境のみ読み込む。未設定時は既定値） |

### データ再生成（任意）

CSV・API から JSON を作り直す手順はページごとに違います。[docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) と `/pipeline` スキル（`.claude/skills/`）を参照してください。元データは `data/`（Git 管理外）に置きます。代表的なコマンド:

```bash
npm run download-rs-csv-2025         # RS の CSV を取得・展開
npm run generate-unified-budget-graph # サンキー図（予算書×RS）
npm run generate-subcontracts-2025   # 委託構造
npm run score-quality-ai-2025        # AI 評価
npm run generate-project-map         # バブルチャート（埋め込み）
npm run generate-funds               # 基金
npm run generate-vendors             # 事業者
npm run compress-data                # gzip 圧縮（Git 管理用）
```

---

## npm スクリプト（開発・検証）

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー（Turbopack、ポート 3000） |
| `npm run build` / `npm start` | 本番ビルド（prebuild で .gz を展開）/ 本番サーバー |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript の型チェック（データ展開不要） |
| `npm test` | 単体テスト（ドメイン・API・AI ツール） |
| `npm run test:e2e` | Playwright E2E（初回は `npx playwright install chromium`。`data-testid` は Playwright 実行時だけ出力） |
| `npm run test:e2e:ui` / `:headed` / `:report` | Playwright の UI モード / ブラウザ表示 / HTML レポート |

CI（`.github/workflows/checks.yml`）は PR に対して typecheck・lint・単体テスト・E2E（本番ビルド）・依存の監査を実行します。

---

## AI ナビ・MCP・スキル

- **AI ナビ**: ヘッダーの「AI」。絞り込み（「環境省で 100 億円以上」「総合点が低い事業」）、データの問い合わせ（「この事業の支出先は」「年収 500 万円の税と保険料は」）、ページ移動（「委託構造に行って」）に対応。財政余力や国民負担のページでは、画面の計算結果を読んで答えます
- **MCP サーバー**: `POST /api/mcp`（Streamable HTTP・認証なし・公開データのみ）。事業・支出先・使途の検索、事業詳細、AI 評価、再委託チェーン、年度比較、注目事業、支出先一覧、基金、事業者、概算要求、租税特別措置、家計の税負担の試算など 18 ツール。仕様は [docs/api-guide.md](docs/api-guide.md) の「MCP サーバー」
  ```bash
  claude mcp add --transport http rs-vis https://rs-vis.team-mir.ai/api/mcp
  ```
- **スキル**: [skills/rs-vis-data/SKILL.md](skills/rs-vis-data/SKILL.md)。データの約束事（1 円単位・シート年度・「その他」の違い・AI 評価の位置づけ・出典表示）、ツールの使い分け、典型的な問いの手順。Claude Code では `.claude/skills/` にコピーするか、リポジトリの `skills/` を指して取り込む

---

## デプロイ（Vercel）

開発は `dev` ブランチで行い、`dev` → `main` の PR をマージすると Vercel が自動ビルドします（東京リージョン `hnd1`）。`main` への直接 push はしません。

- Vercel プロジェクトと環境変数は `infra/terraform/` の Terraform で管理（手順は [infra/terraform/README.md](infra/terraform/README.md)）
- Supabase のスキーマは `supabase/schema.sql`、追加変更は `supabase/migrations/`
- データ更新時は `compress-data` で `.gz` を作ってコミットする

---

## プロジェクト構成

```
.
├── app/                 # Next.js App Router（ページ・API・ドメインロジック）
│   ├── api/             # API エンドポイント群（/api/mcp、/api/ai、/api/sankey など）
│   └── lib/             # Pure なドメインロジック（HTTP・React を含まない）
├── client/              # クライアント側（components / hooks / lib）
├── components/          # 共通 UI（ナビゲーション・フィルタ部品・法務文書）
├── types/               # 全レイヤー共通の型定義
├── scripts/             # データ生成（Python / TypeScript）
├── public/data/         # 生成データ（.gz のみ Git 管理）
├── data/                # ローカルの元データ（Git 管理外）
├── supabase/            # スキーマ・マイグレーション
├── infra/terraform/     # Vercel・環境変数の IaC
├── skills/              # 外部の AI 向けスキル
├── tests/               # 単体テスト・E2E（tests/e2e）
└── docs/                # 設計・仕様・監査のドキュメント（docs/tasks は作業記録）
```

レイヤーの規約（`scripts/` は CSV 処理のみ、`app/lib/` は Pure、`client/` は `app/lib/api/*-loader` を import しない等）は [CLAUDE.md](CLAUDE.md) にあります。

---

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [docs/data-pipeline-guide.md](docs/data-pipeline-guide.md) | ページ別データパイプライン（必要 CSV・生成コマンド） |
| [docs/api-guide.md](docs/api-guide.md) | API エンドポイントと MCP サーバーの仕様 |
| [docs/sankey-architecture-guide.md](docs/sankey-architecture-guide.md) | サンキー図（統合ビュー）の構成 |
| [docs/quality-scoring-guide.md](docs/quality-scoring-guide.md) | 執行透明性スコアの詳細 |
| [docs/policy-decision-scoring.md](docs/policy-decision-scoring.md) | AI 政策評価（総合点・6 項目・推奨判断）の決め方 |
| [docs/budget-requests.md](docs/budget-requests.md) | 概算要求の取得と RS 事業への対応づけ |
| [docs/fiscal-space-*.md](docs/) | 財政余力シミュレータの前提・校正・監査・バックテスト |
| [docs/rs-data-scope.md](docs/rs-data-scope.md) | RS システムの対象データと対象外 |
| [docs/rs-fiscal-year-navigation.md](docs/rs-fiscal-year-navigation.md) | シート年度と予算年度の扱い |

---

## データソース

- [行政事業レビュー見える化サイト（RS システム）](https://rssystem.go.jp/)（レビューシート・基金シート・公開 API）
- [財務省 予算書・決算書データベース](https://www.bb.mof.go.jp/)、[予算執行調査](https://www.mof.go.jp/policy/budget/topics/budget_execution_audit/)、[租税特別措置の適用実態調査](https://www.mof.go.jp/tax_policy/reference/stm_report/)
- [会計検査院 検査報告データベース](https://report.jbaudit.go.jp/)
- [e-Stat 政府統計の総合窓口](https://www.e-stat.go.jp/)（家計調査など）
- [国税庁 法人番号公表サイト](https://www.houjin-bangou.nta.go.jp/)（法人番号照合）

出典と利用条件の一覧は `app/lib/data-sources.ts`（利用規約第 6 条・紹介ページと共用）にあります。

## ライセンス

[GNU Affero General Public License v3.0](LICENSE)
