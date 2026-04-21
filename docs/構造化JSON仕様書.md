# RS2024 構造化JSON仕様書

## 概要

RS2024（行政事業レビュー2024年度）の正規化済みCSVデータから、Sankey図やその他の可視化に利用可能な構造化JSONデータを生成する。

TopNフィルタリングとは独立した、**全事業の完全な構造化データ**を提供することで、フロントエンド側で柔軟にTopN選択やフィルタリングを行えるようにする。

## データソース

以下の正規化済みCSVファイルを使用：

- `1-1_RS_2024_基本情報_組織情報.csv` - 事業の組織情報
- `1-2_RS_2024_基本情報_事業概要等.csv` - 事業の概要情報（開始年度、終了年度等）
- `2-1_RS_2024_予算・執行_サマリ.csv` - 予算・執行のサマリ情報
- `5-1_RS_2024_支出先_支出情報.csv` - 支出先と支出金額の詳細

## 出力ファイル

`public/data/rs2024-structured.json` - 全データを含む単一の構造化JSONファイル
- 2024年度の予算・支出データ（`budgets`、`spendings`、`budgetTree`、`statistics`）
- 過去年度（2023年度以前）の予算データ（`historicalBudgets`）

## データ構造

### トップレベル構造

```typescript
interface RS2024StructuredData {
  metadata: Metadata;
  budgetTree: BudgetTree;
  budgets: BudgetRecord[];              // 2024年度の予算レコード
  spendings: SpendingRecord[];
  statistics: Statistics;
  historicalBudgets: BudgetRecord[];    // 過去年度（2023年度以前）の予算レコード
}
```

### 1. メタデータ (Metadata)

生成日時やデータの概要情報。

```typescript
interface Metadata {
  generatedAt: string;           // ISO 8601形式の生成日時
  fiscalYear: number;             // 会計年度（2024）
  dataVersion: string;            // データバージョン（例: "1.0.0"）
  totalProjects: number;          // 総事業数
  totalRecipients: number;        // 総支出先数
  totalBudgetAmount: number;      // 総予算額（円）
  totalSpendingAmount: number;    // 総支出額（円）
}
```

### 2. 予算ツリー (BudgetTree)

府省庁を起点とした階層構造のツリー。各ノードは予算額の合計を持つ。

```typescript
interface BudgetTree {
  totalBudget: number;            // 総予算額
  ministries: MinistryNode[];     // 府省庁ノードの配列
}

interface MinistryNode {
  id: number;                     // 府省庁の一意識別子（自動採番）
  name: string;                   // 府省庁名
  totalBudget: number;            // 府省庁の総予算額
  bureaus: BureauNode[];          // 局・庁ノードの配列
  projectIds: number[];           // この府省庁直下の事業IDリスト
}

interface BureauNode {
  id: number;                     // 局・庁の一意識別子（自動採番）
  name: string;                   // 局・庁名
  totalBudget: number;            // 局・庁の総予算額
  departments: DepartmentNode[];  // 部ノードの配列（存在する場合）
  projectIds: number[];           // この局・庁直下の事業IDリスト
}

interface DepartmentNode {
  id: number;                     // 部の一意識別子（自動採番）
  name: string;                   // 部名
  totalBudget: number;            // 部の総予算額
  divisions: DivisionNode[];      // 課ノードの配列（存在する場合）
  projectIds: number[];           // この部直下の事業IDリスト
}

interface DivisionNode {
  id: number;                     // 課の一意識別子（自動採番）
  name: string;                   // 課名
  totalBudget: number;            // 課の総予算額
  offices: OfficeNode[];          // 室ノードの配列（存在する場合）
  projectIds: number[];           // この課直下の事業IDリスト
}

interface OfficeNode {
  id: number;                     // 室の一意識別子（自動採番）
  name: string;                   // 室名
  totalBudget: number;            // 室の総予算額
  groups: GroupNode[];            // 班ノードの配列（存在する場合）
  projectIds: number[];           // この室直下の事業IDリスト
}

interface GroupNode {
  id: number;                     // 班の一意識別子（自動採番）
  name: string;                   // 班名
  totalBudget: number;            // 班の総予算額
  sections: SectionNode[];        // 係ノードの配列（存在する場合）
  projectIds: number[];           // この班直下の事業IDリスト
}

interface SectionNode {
  id: number;                     // 係の一意識別子（自動採番）
  name: string;                   // 係名
  totalBudget: number;            // 係の総予算額
  projectIds: number[];           // この係の事業IDリスト
}
```

### 3. 予算レコード (BudgetRecord)

全事業の詳細情報をフラットなリストで管理。

- `budgets`: 2024年度（`fiscalYear: 2024`）の予算レコードのみ含む
- `historicalBudgets`: 過去年度（2023年度以前）の予算レコードを含む
- 両配列とも同じ構造の `BudgetRecord` インターフェースを使用

```typescript
interface BudgetRecord {
  // 基本情報
  projectId: number;              // 予算事業ID（元CSVの予算事業IDを数値化）
  projectName: string;            // 事業名
  fiscalYear: number;             // 事業年度
  projectStartYear: number;       // 事業開始年度（不明な場合は0）
  projectEndYear: number;         // 事業終了(予定)年度（終了予定なしの場合は0）

  // 組織情報
  ministry: string;               // 府省庁
  bureau: string;                 // 局・庁（空文字列の場合あり）
  department: string;             // 部（空文字列の場合あり）
  division: string;               // 課（空文字列の場合あり）
  office: string;                 // 室（空文字列の場合あり）
  group: string;                  // 班（空文字列の場合あり）
  section: string;                // 係（空文字列の場合あり）
  hierarchyPath: string[];        // 組織階層のパス配列

  // 予算情報（円単位）
  initialBudget: number;          // 当初予算
  supplementaryBudget: number;    // 補正予算合計
  carryoverBudget: number;        // 前年度からの繰越し合計
  reserveFund: number;            // 予備費等合計
  totalBudget: number;            // 計（歳出予算現額合計）

  // 執行情報（円単位）
  executedAmount: number;         // 執行額合計
  executionRate: number;          // 執行率（%、0-100）
  carryoverToNext: number;        // 翌年度への繰越し合計
  nextYearRequest: number;        // 翌年度要求額合計

  // 会計情報
  accountCategory: string;        // 会計区分
  account: string;                // 会計
  accountingSubdivision: string;  // 勘定

  // 支出先情報
  spendingIds: number[];          // 支出先IDの配列
  totalSpendingAmount: number;    // この事業の総支出額
}
```

### 4. 支出レコード (SpendingRecord)

全支出先の詳細情報をフラットなリストで管理。

```typescript
interface SpendingRecord {
  // 基本情報
  spendingId: number;             // 支出先ID（自動採番）
  spendingName: string;           // 支出先名

  // 法人情報
  corporateNumber: string;        // 法人番号（13桁、存在しない場合は空文字列）
  location: string;               // 所在地
  corporateType: string;          // 法人種別（コード）

  // 支出情報
  totalSpendingAmount: number;    // この支出先が受け取った総額（円）
  projectCount: number;           // この支出先に支出している事業数
  projects: SpendingProject[];    // 事業からの支出リスト
}

interface SpendingProject {
  projectId: number;              // 予算事業ID
  amount: number;                 // この事業からの支出額（円）
  blockNumber: string;            // 支出先ブロック番号
  blockName: string;              // 支出先ブロック名
  contractSummary: string;        // 契約概要
  contractMethod: string;         // 契約方式等
}
```

### 5. 統計情報 (Statistics)

データ全体の統計サマリ。

```typescript
interface Statistics {
  // 府省庁別統計
  byMinistry: {
    [ministryName: string]: {
      projectCount: number;       // 事業数
      totalBudget: number;        // 総予算額
      totalSpending: number;      // 総支出額
      recipientCount: number;     // 支出先数
    };
  };

  // 支出先数ランキング（Top100）
  topSpendingsByAmount: {
    spendingId: number;
    spendingName: string;
    totalSpendingAmount: number;
    projectCount: number;
  }[];

  // 事業ランキング（Top100）
  topProjectsByBudget: {
    projectId: number;
    projectName: string;
    ministry: string;
    totalBudget: number;
  }[];

  topProjectsBySpending: {
    projectId: number;
    projectName: string;
    ministry: string;
    totalSpendingAmount: number;
  }[];
}
```

## 生成ルール

### 1. IDの生成

#### 予算事業ID
- 元CSVの `予算事業ID` を数値として使用（例：`"1"` → `1`）

#### 支出先ID
- 支出先名と法人番号の組み合わせで一意性を判定：
  - 同じ支出先名 + 同じ法人番号 → 同一支出先として統合
  - 同じ支出先名 + 異なる法人番号 → 別支出先として扱う
  - 同じ支出先名 + 片方のみ法人番号あり → 別支出先として扱う
- 支出先IDは自動採番（1から順に連番）

#### 組織階層ノードID
- 各階層ノード（府省庁、局・庁、部、課、室、班、係）のIDは自動採番（1から順に連番）
- 階層が深い順に採番（係 → 班 → 室 → 課 → 部 → 局・庁 → 府省庁）

### 2. 組織階層の構築

`1-1_RS_2024_基本情報_組織情報.csv` の以下のフィールドから階層を構築：

```
府省庁 > 局・庁 > 部 > 課 > 室 > 班 > 係
```

- 各階層で空文字列の場合、その階層は存在しないものとして扱う
- 各ノードの `totalBudget` は配下の全事業の予算額合計
- 各ノードの `projectIds` は直接その階層に属する事業のIDリスト

### 3. 事業期間の処理

`1-2_RS_2024_基本情報_事業概要等.csv` から事業期間情報を取得：

- `事業開始年度`: 数値に変換（空の場合や不明の場合は `0`）
- `開始年度不明` が `TRUE` の場合: `projectStartYear` は `0`
- `事業終了(予定)年度`: 数値に変換（空の場合は `0`）
- `終了予定なし` が `TRUE` の場合: `projectEndYear` は `0`

### 4. 予算額の計算

`2-1_RS_2024_予算・執行_サマリ.csv` から予算情報を取得：

- 同一 `予算事業ID` + `予算年度` の組み合わせで複数行存在する場合（会計区分ごとの行）、合算する
- `予算年度` が `2024` の予算レコードは `budgets` 配列に格納
- `予算年度` が `2023` 以前の予算レコードは `historicalBudgets` 配列に格納
- 空文字列や不正な値は `0` として扱う

### 5. 支出額の計算

`5-1_RS_2024_支出先_支出情報.csv` から支出情報を取得：

- 同一 `予算事業ID` + `支出先名` + `法人番号` の組み合わせで金額を合算
- `金額` フィールドが空の場合は `0` として扱う
- 支出先ブロックレベルの合計支出額（`ブロックの合計支出額`）は使用せず、個別の支出先レコードの `金額` を集計

## データ整合性チェック

生成時に以下のチェックを実施：

1. **予算ツリーの合計チェック**: 各階層ノードの `totalBudget` が子ノードの合計と一致
2. **予算レコードの整合性**: `totalSpendingAmount` が該当する支出レコードの金額合計と一致
3. **支出レコードの整合性**: `totalSpendingAmount` が `projects` 配列の金額合計と一致
4. **相互参照の整合性**:
   - `BudgetRecord.spendingIds[]` の各IDが `SpendingRecord.spendingId` に存在
   - `SpendingRecord.projects[].projectId` が `BudgetRecord.projectId` に存在
   - 組織階層ノードの `projectIds[]` の各IDが `BudgetRecord.projectId` に存在

## ファイルサイズ（実測値）

- 2024年度事業数: 5,003件
- 支出先数: 26,823件（再委託先含む）

| ファイル | サイズ |
|---------|--------|
| `rs2024-structured.json`（非圧縮） | ~96MB |
| `rs2024-structured.json.gz`（Git管理） | ~11MB |

## 利用例

### Sankey図でのTopN選択（クライアント側）

```typescript
// Top10府省庁を選択
const topMinistries = Object.entries(data.statistics.byMinistry)
  .sort((a, b) => b[1].totalBudget - a[1].totalBudget)
  .slice(0, 10)
  .map(([name]) => name);

// Top10府省庁の事業を全体でTop20選択
const topProjects = data.budgets
  .filter(p => topMinistries.includes(p.ministry))
  .sort((a, b) => b.totalBudget - a.totalBudget)
  .slice(0, 20);

// Top20事業の支出先IDを収集し、支出額でTop20選択
const spendingIdSet = new Set(topProjects.flatMap(p => p.spendingIds));
const relevantSpendings = data.spendings.filter(s => spendingIdSet.has(s.spendingId));
const topSpendings = relevantSpendings
  .sort((a, b) => b.totalSpendingAmount - a.totalSpendingAmount)
  .slice(0, 20);
```

### 組織階層ドリルダウン

```typescript
// 厚生労働省 > 医政局 の配下事業を取得
const ministry = data.budgetTree.ministries.find(m => m.name === '厚生労働省');
const bureau = ministry?.bureaus.find(b => b.name === '医政局');
const projectIds = bureau?.projectIds || [];
const projects = data.budgets.filter(p => projectIds.includes(p.projectId));
```

## 実装スクリプト

`scripts/generate-structured-json.ts` として実装。

```bash
npm run generate-structured
```

で生成可能。
