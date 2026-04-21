# Sankey Architecture Guide

このドキュメントは `/sankey`（動的生成・Nivo版）のアーキテクチャを説明する。
他のSankey実装については以下を参照。

| ページ | 実装 | 特徴 |
|--------|------|------|
| `/sankey`（本ドキュメント） | Nivo Sankey + APIオンデマンド | 5列・全府省庁対応・ドリルダウン |
| `/sankey-svg` | SVG Canvas + 事前計算グラフ | 直接支出のみ・2024/2025両年度 |
| `/sankey2` | Canvas描画 + 事前計算レイアウト | Treemapクラスタ配置・2024固定 |

---

Sankey図システムのアーキテクチャ・UI・生成アルゴリズムの詳細。

---

## 1. データモデル

### BudgetRecord（事業予算）
```typescript
{
  projectId: number
  projectName: string
  fiscalYear: 2024

  // 組織階層（7段階）
  ministry: string        // 府省庁
  bureau: string          // 局・庁
  department: string      // 部
  division: string        // 課
  office: string          // 室
  group: string           // 班
  section: string         // 係
  hierarchyPath: string[] // UI表示用フルパス

  // 予算内訳（単位: 1円）
  initialBudget: number        // 当初予算
  supplementaryBudget: number  // 補正予算
  carryoverBudget: number      // 前年度繰越
  reserveFund: number          // 予備費等
  totalBudget: number          // 歳出予算現額合計

  // 執行情報
  executedAmount: number       // 執行額
  executionRate: number        // 執行率 (%)
  carryoverToNext: number      // 翌年度繰越

  // 関連
  spendingIds: number[]        // SpendingRecord.spendingId への参照
  totalSpendingAmount: number  // 支出合計
}
```

### SpendingRecord（支出先）
```typescript
{
  spendingId: number
  spendingName: string    // 支出先名

  corporateNumber: string // 法人番号
  location: string        // 所在地
  corporateType: string   // 法人種別

  totalSpendingAmount: number  // 支出合計（1円単位）
  projectCount: number         // 関連事業数

  projects: {
    projectId: number
    amount: number          // この事業からの支出額
    blockNumber: string     // 支出先ブロック番号
    blockName: string       // ブロック名
    contractSummary: string // 契約概要
    contractMethod: string  // 契約方式
  }[]
}
```

### SankeyNode（ビジュアライゼーション）
```typescript
{
  id: string   // 図内でユニーク
  name: string // 表示テキスト
  type: 'ministry-budget' | 'project-budget' |
        'project-spending' | 'recipient' | 'other'
  value: number       // 予算・支出額（1円単位）
  originalId?: number // 元データへの参照
  details?: { /* 府省庁・事業・支出先それぞれの詳細 */ }
}
```

### SankeyLink（接続）
```typescript
{
  source: string  // Source node ID
  target: string  // Target node ID
  value: number   // フロー量（1円単位）
  details?: { contractMethod?: string; blockName?: string }
}
```

---

## 2. 5列Sankeyの構造

```
Column 1    Column 2      Column 3        Column 4        Column 5
予算総計  → 府省庁        → 事業(予算)     → 事業(支出)     → 支出先
          (ministry-     (project-       (project-       (recipient)
           budget)        budget)         spending)
          ↓              ↓               ↓               ↓
          その他の       その他の         その他の         その他
          府省庁         事業             事業            その他の支出先
```

**カラーコード**:
- `ministry-budget`, `project-budget` → `#10b981`（緑）
- `project-spending`, `recipient` → `#ef4444`（赤）
- `その他`で始まるノード → `#6b7280`（グレー）

---

## 3. 特殊ノードの仕様

| ノード名 | 種別 | 説明 |
|---------|------|------|
| `その他の府省庁` | other | TopN以外の府省庁集計（ページネーションで表示） |
| `その他の事業` | other | 府省庁ごとのTopN以外の事業集計 |
| `その他` | recipient | 支出先名が「その他」のもの（~26兆円）|
| `その他の支出先` | other | TopN以外の支出先集計（~51兆円）|

> **重要**: 「その他」と「その他の支出先」は別ノード。混同しないこと。

---

## 4. Sankey生成アルゴリズム（sankey-generator.ts）

### TopN再帰選択フロー
```
1. 府省庁を予算額でソート → TopN を選択
2. 選択した各府省庁:
   a. 事業を予算額でソート → TopN を選択
   b. 残りを「その他の事業」として集計
3. 選択した各事業:
   a. 支出先（支出先名が「その他」以外）を支出額でソート → TopN 選択
   b. 残りを「その他の支出先」として集計
   c. 支出先名が「その他」のものは別集計（「その他」ノード）
4. 5列のノード・リンクを構築
```

### GenerateOptions（APIパラメータ）
```typescript
{
  offset?: number          // 府省庁ページネーション
  limit?: number           // TopN府省庁数（default: 3）
  projectLimit?: number    // TopN事業数（default: 3）
  spendingLimit?: number   // TopN支出先数（default: 3）
  ministryName?: string    // 府省庁ビュー絞り込み
  projectName?: string     // 事業ビュー絞り込み
  recipientName?: string   // 支出先ビュー絞り込み
}
```

---

## 5. UI状態管理（app/sankey/page.tsx）

### viewMode の遷移

```
global ─── クリック:府省庁ノード ──→ ministry
       ←── クリック:予算総計 ────────
ministry ── クリック:事業ノード ──→ project
        ←── クリック:予算総計 ────────
project ─── クリック:支出先ノード ──→ spending
        ←── クリック:予算総計 ────────
```

### ノードクリックハンドラ

```
handleNodeClick(node)
  ├─ 「予算総計」→ 1段階上に戻る（または offset を戻す）
  ├─ 「その他の府省庁」→ offset を +topN してページネーション
  ├─ ministry ノード → ministry ビューに切り替え
  ├─ project ノード
  │   ├─ 「その他の事業」→ 何もしない
  │   └─ それ以外 → project ビューに切り替え
  └─ recipient ノード
      ├─ 「その他」→ spending ビュー（"その他"）
      ├─ 「その他の支出先」→ offset を +spendingLimit
      └─ それ以外 → spending ビューに切り替え
```

### URLスキーム（ permalink）

```
/sankey                                      # グローバルビュー
/sankey?offset=3                             # 次の府省庁ページ
/sankey?ministry=厚生労働省                   # 府省庁ビュー
/sankey?ministry=厚生労働省&project=事業名    # 事業ビュー
/sankey?recipient=支出先名                   # 支出先ビュー
```

---

## 6. Nivo Sankey 設定

```typescript
margin: { top: 40, right: 200, bottom: 40, left: 200 }  // Desktop
margin: { top: 40, right: 100, bottom: 40, left: 100 }  // Mobile
height: 800px
align: 'justify'
sort: 'input'
nodeOpacity: 1
nodeHoverOthersOpacity: 0.35
linkOpacity: 0.5
linkHoverOthersOpacity: 0.1
```

**カスタムラベルレイヤー**:
- ノード名 + 金額の2行ラベルをノード外側に描画
- 予算ノード: 左側に右寄せ / 支出ノード: 右側に左寄せ
- 金額フォーマット: 兆円 / 億円 / 万円 / 円

---

## 7. パフォーマンス特性

| 項目 | 値 |
|-----|----|
| 初期ページ読み込み | ~100-200ms |
| API レスポンス | ~50-100ms（メモリキャッシュ） |
| Sankey 初回描画 | ~500-1000ms |
| ナビゲーション時再描画 | ~300-500ms |
| サーバーメモリ使用量 | ~200MB（JSON キャッシュ） |
| Sankey 最大ノード数 | ~2000 nodes / ~3000 links |
