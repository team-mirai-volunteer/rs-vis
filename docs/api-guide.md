# API Guide

全 API エンドポイントの仕様。

---

## GET /api/sankey

動的に Sankey データを生成して返す。

### クエリパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `offset` | number | 0 | 府省庁ページネーション（グローバルビューのみ） |
| `limit` | number | 3 | 表示する府省庁数（TopN） |
| `projectLimit` | number | 3 | 府省庁ごとの事業数（TopN） |
| `spendingLimit` | number | 3 | 事業ごとの支出先数（TopN） |
| `ministryName` | string | — | 府省庁ビュー：絞り込む府省庁名 |
| `projectName` | string | — | 事業ビュー：絞り込む事業名 |
| `recipientName` | string | — | 支出先ビュー：絞り込む支出先名 |

### ビュータイプの判定ロジック

```
recipientName あり → presetType: 'spending'
projectName あり   → presetType: 'project'
ministryName あり  → presetType: 'ministry'
それ以外           → presetType: 'global'
```

### レスポンス（RS2024PresetData）

```typescript
{
  metadata: {
    generatedAt: string          // ISO8601
    fiscalYear: 2024
    presetType: 'global' | 'ministry' | 'project' | 'spending'
    filterSettings: {
      topMinistries: number
      topProjects: number
      topSpendings: number
      sortBy: string
    }
    summary: {
      totalMinistries: number    // 全府省庁数
      totalProjects: number      // 全事業数
      totalSpendings: number     // 全支出先数
      selectedMinistries: number // 選択された府省庁数
      selectedProjects: number   // 選択された事業数
      selectedSpendings: number  // 選択された支出先数
      totalBudget: number        // 全体予算（1円単位）
      selectedBudget: number     // 選択範囲の予算（1円単位）
      coverageRate: number       // カバレッジ率（%）
    }
  },
  sankey: {
    nodes: SankeyNode[]
    links: SankeyLink[]
  }
}
```

### サーバー側処理（sankey-generator.ts）

1. `rs2024-structured.json` を読み込み（メモリキャッシュ）
2. ビュータイプとフィルタに基づいてデータを選択
3. Sankey ノードとリンクを構築
4. カバレッジ統計を含むメタデータを生成
5. JSON で返却

### URLとビューの対応

| URL | ビュータイプ |
|-----|-------------|
| `/api/sankey` | global（全府省庁 Top3） |
| `/api/sankey?offset=3` | global（次の府省庁ページ） |
| `/api/sankey?ministryName=厚生労働省&limit=5` | ministry |
| `/api/sankey?ministryName=厚生労働省&projectName=事業名` | project |
| `/api/sankey?recipientName=支出先名` | spending |

---

## GET /api/sankey/mof-overview

財務省（MOF）予算全体ビュー用の Sankey データを返す。

**クエリパラメータ**: なし

**データソース**: `public/data/mof-budget-overview-2023.json`（サーバープロセス内にタイムベースキャッシュ、TTL=1時間）

---

## GET /api/quality-scores

事業別品質スコア一覧を返す。

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/project-quality-scores-{year}.json`

**レスポンス**: `QualityScoresResponse`（`items: QualityScoreItem[]` と `summary` を含む）

---

## GET /api/quality-scores/recipients

事業の支出先明細（品質詳細ダイアログ用）を返す。

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `pid` | string | **必須** | 予算事業ID |
| `year` | string | `"2024"` | 対象年度 |

**データソース**: `public/data/project-quality-recipients-{year}.json`

**レスポンス**: `RecipientRow[]`（支出先行ごとの品質情報）

フィールド名は短縮形（JSONサイズ削減）:

| フィールド | 意味 |
|-----------|------|
| `n` | 支出先名 |
| `b` | 支出先ブロック番号 |
| `s` | 判定ステータス（`valid`/`gov`/`supp`/`invalid`/`unknown`） |
| `c` | 法人番号記入あり |
| `o` | 不透明キーワードにマッチ |
| `a2` | 個別支出額（null=空欄） |
| `r` | ルートブロック（直接支出）か |
| `chain` | ブロック委託チェーン（例: `"組織→A→B"`） |
| `d` | 委託深度 |
| `role` | 事業を行う上での役割 |
| `cc` | 契約概要 |

---

## GET /api/project-details/[projectId]

事業詳細情報（事業概要・実施方法等）を返す。

**パスパラメータ**: `projectId`（予算事業ID）

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/rs{year}-project-details.json`

---

## GET /api/subcontracts/[projectId]

再委託構造データを返す。

**パスパラメータ**: `projectId`（予算事業ID）

**クエリパラメータ**:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `year` | string | `"2024"` | 対象年度（`"2024"` または `"2025"`） |

**データソース**: `public/data/subcontracts-{year}.json`

**レスポンス**: `SubcontractGraph`（ブロックノード・エッジ・支出先情報）

---

## GET /api/entities

支出先エンティティ一覧（法人番号・NTA照合情報付き）を返す。

**クエリパラメータ**: なし

**データソース**: `rs2024-structured.json`、`entity-normalization.json`、`houjin-lookup.json`

**レスポンス**: `EntitiesResponse`（`EntityListItem[]` + サマリー）

---

## GET /api/entities-v2

エンティティ一覧（`entity-labels-csv.json` の L1/L2 ラベル付き）を返す。

**クエリパラメータ**: なし

**データソース**: `rs2024-structured.json`、`entity-normalization.json`、`houjin-lookup.json`、`entity-labels-csv.json`

**レスポンス**: `EntitiesV2Response`（`EntityListItemV2[]` + L1/L2別サマリー）

---

## GET /api/entity-labels-csv

支出先エンティティのラベル一覧（CSV出力用）を返す。

**クエリパラメータ**: なし

**データソース**: `entity-labels-csv.json`

**レスポンス**: `EntityLabelsCsvResponse`（`EntityLabelItem[]` + ラベル別サマリー）

---

## GET /api/map/globe, /api/map/circuit, /api/map/treemap

地図・回路図・ツリーマップ用のデータを返す（`/map` ページ用）。

**クエリパラメータ**: なし（各エンドポイントにより異なる）

**データソース**: `rs2024-structured.json`（インメモリ加工）

---

## MCP サーバー: POST /api/mcp

外部の AI（Claude Code・claude.ai・その他の MCP クライアント）が、このサイトのデータをツールとして引くための入口。
Streamable HTTP（ステートレス・セッション無し）。認証なし（公開データのみ）。LLM は呼ばないので従量課金は発生しない。

- ツールの定義: `app/lib/ai/mcp-tools.ts`（チャットのエージェント `app/lib/ai/chat-core.ts` の `TOOLS` から `submit_result` を除き、各ツールに `year` を足したもの）
- 実行: `app/lib/ai/chat-core.ts` の `executeToolCall`（引数検証）→ `app/lib/ai/tool-executor-server.ts`（ローダ直呼び）
- ルート: `app/api/mcp/route.ts`（`mcp-handler` + `@modelcontextprotocol/server`）

### ツール一覧

| ツール | 主な引数 | 返すもの |
|---|---|---|
| `search_projects` | `q`、`scope`（`name` / `details`） | 事業名（または概要）に一致する事業の上位 10 件と総件数 |
| `search_recipients` | `q` | 支出先名に一致する支出先 |
| `search_spending` | `q`（2 文字以上） | 支出の役割・契約概要の全文検索 |
| `get_project_detail` | `pid` | 事業の概要・予算・執行・AI 評価・上位の支出先 |
| `get_quality_scores` | `pids`（最大 10 件） | AI 評価（試行）の内訳 |
| `get_recipient_detail` | `key` | 支出先の受注事業一覧 |
| `get_subcontract_chain` | `pid` | 再委託の連鎖（ブロック構造） |
| `get_highlights` | `metric`（`spendingChange` `otherRatio` `concentration` `lowScoreHighBudget` `execBudgetGap` `subcontractDepth`） | 指標ごとの注目事業 |
| `compare_years` | `query`、`baseYear`、`compareYear` | 条件に合う事業の年度間比較 |
| `run_sankey_query` | `query`（SankeyQuery） | 条件に合う事業・支出先の件数・金額・上位 10 件 |
| `get_project_recipients` | `pid` | 支出先一覧（上位 20 件。金額・法人番号・契約方式・応札者数・落札率・役割・再委託の階層） |
| `search_funds` | `q` または `pid` | 基金の検索（残高・国庫返納・終了予定・点検シグナル。上位 10 件） |
| `get_fund` | `key` | 基金 1 件の詳細（年度別の残高・収支・保有割合、造成の経緯、必要性・点検の記載、関連事業） |
| `get_vendor` | `q` または `key` | 事業者の検索（上位 10 件）／ 1 件の詳細（年度別の受注額、1 者応札の件数、主な府省、1 者応札が続く事業） |
| `get_budget_request` | `pid` | 来年度（2027 年度）概算要求。レビューシートの要求額と財務省明細表の 目 ごとの額の突き合わせ |

すべてのツールに `year`（RS シート年度 `"2024"` / `"2025"`。省略時 `"2024"`）がある。シート年度 N には N-1 年度の執行・支出先が載る。
サーバーの `instructions` でデータの約束事（金額は 1 円単位、「その他」と「その他の支出先」の違い、AI 評価は試行、出典の明記）を渡している。

### 接続

```bash
# Claude Code
claude mcp add --transport http rs-vis https://rs-vis.team-mir.ai/api/mcp
# ローカル開発
claude mcp add --transport http rs-vis-local http://localhost:3000/api/mcp
```

### 動作確認（curl）

日本語を含む本文はシェルの文字コードで化けることがあるので、UTF-8 のファイルから送る。

```bash
cat > body.json <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_projects","arguments":{"q":"子育て","year":"2025"}}}
JSON
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data-binary @body.json
# tools/list は {"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

応答は `event: message` / `data: {...}` の SSE 形式（1 メッセージで終わる）。ツールの結果は `result.content[0].text` に JSON 文字列で入る。引数の検証エラーは `isError: true`。

---

## POST /api/sankey/matches

SankeyQuery の条件に合う事業 ID（pid）の一覧だけを返す。AI ナビの結果を評価一覧・委託構造・バブル図に当てるとき、一覧の行に無い条件（支出先名・支出額・再委託・会計区分）をサーバー側でサンキー図のグラフに対して評価するために使う。判定は `/budget-sankey`・AI ツールと同じ `buildFilterExcludedIds`。LLM は呼ばない。

- body: `{ "query": SankeyQuery }`（`year` 省略時は既定年度）
- 200: `{ year, count, projectIds: string[] }` ／ 400: 条件が不正

```bash
curl -s -X POST http://localhost:3000/api/sankey/matches -H 'Content-Type: application/json' \
  -d '{"query":{"year":"2025","filter":{"recipientName":{"query":"NTTデータ","includeSubcontract":true}}}}'
```
