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
