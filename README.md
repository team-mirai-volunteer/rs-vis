# RS2024 サンキー図システム

2024年度 行政事業レビューシステムの予算・支出データをサンキー図で可視化するWebアプリケーション。

## 概要

本システムは、日本政府の行政事業レビューシステム（RS System）の2024年度データを使用して、予算配分と支出フローを視覚的に表現します。

### 主な機能

- **📊 5列サンキー図**: 予算総計 → 府省庁（予算）→ 事業（予算）→ 事業（支出）→ 支出先の全体フローを可視化
- **🔍 4つのビューモード**:
  - **全体ビュー**: 府省庁TopN表示、階層的ドリルダウン対応
  - **府省庁ビュー**: 特定府省庁の事業と支出先の詳細、事業ドリルダウン機能
  - **事業ビュー**: 個別事業の支出内訳を詳細表示
  - **支出ビュー**: 受給者への全資金源を表示
- **📋 モーダル機能**:
  - **事業一覧モーダル**: 全15,111事業を検索・ソート・フィルタリング
    - 府省庁フィルター（マルチ選択、予算額降順）
    - 事業名・支出先検索
    - 支出先展開/まとめ表示切替
    - クリック位置による自動ビュー遷移
    - ページネーション（100件/ページ）
  - **支出先一覧モーダル**: 全25,892支出先を検索・分析
    - 支出先ごとに金額をまとめて表示
    - 事業名でまとめるチェックボックス機能
    - 複数府省庁の内訳表示（「厚生労働省 他35件」形式）
    - 府省庁別支出額モーダル
  - **サマリーダイアログ**: データ統計の表示
- **🎯 階層的ドリルダウンナビゲーション**:
  - 全体ビュー: 府省庁TopNセレクター（▲/▼ボタン + コンボボックス）
  - 府省庁ビュー: 事業TopNセレクター
  - 「その他の府省庁」ノードからTopN除外府省庁を表示
- **⚙️ カスタマイズ可能なTopN設定**:
  - 全体ビュー: 府省庁Top10、支出先Top10
  - 府省庁ビュー: 事業Top10、支出先Top10
  - 事業ビュー: 支出先Top20
  - 支出ビュー: 支出元事業Top15、支出元府省庁Top10
- **💰 支出先名「その他」の独立表示**: 支出先名が「その他」の項目を「支出先(TopN以外)」とは別に集約表示
- **📱 モバイル対応**: スマートフォンでも横スクロールで閲覧可能
- **🎨 ビュー別の色分け**:
  - 予算ノード（緑系）、支出ノード（赤系）
  - TopN以外ノード: グレー系で明確に区別
- **🔗 インタラクティブなナビゲーション**:
  - ノードクリックでドリルダウン
  - パンくずリストで階層移動
  - ブラウザの戻る/進むボタンに完全対応
- **💾 URL状態同期**: すべてのビュー状態がURLに保存され、共有・ブックマーク可能
- **📌 固定UIボタン**: 画面右上に常時表示される「事業一覧」「支出先一覧」「サマリー」「設定」ボタン

## 技術スタック

- **フロントエンド**: Next.js 15 (App Router), React 18, TypeScript
- **スタイリング**: Tailwind CSS
- **可視化**: @nivo/sankey
- **データ処理**: Python 3 (neologdn), Node.js (TypeScript)

## データフロー

### 5列サンキー図構造（全体ビュー）

```
予算総計 (146.63兆円)
  ├─ 府省庁（予算）TopN (デフォルト10)
  │   ├─ 事業（予算）TopN
  │   │   ├─ 事業（支出）
  │   │   │   ├─ 支出先 TopN (デフォルト10)
  │   │   │   ├─ その他（支出先名が「その他」）
  │   │   │   └─ 支出先(TopN以外)
  │   │   └─ 事業(TopN以外) → その他 / 支出先(TopN以外)
  │   └─ 府省庁(TopN以外) → 事業(TopN以外) → その他 / 支出先(TopN以外)
  └─ 府省庁(TopN以外) → その他 / 支出先(TopN以外)
```

### ビューモード詳細

#### 1. 全体ビュー（Global View）
- **特徴**: 府省庁TopN表示、階層的ドリルダウン対応
- **ナビゲーション**:
  - 府省庁TopNセレクター: ▲/▼ボタンで前後のレベルに移動、コンボボックスで直接選択
  - 「その他の府省庁」クリック: TopN除外府省庁を表示
  - 「予算総計」クリック: 事業一覧モーダルを開く
- **データ選択**: 予算額順に府省庁をソート
- **色**: 予算ノード（緑系）、支出ノード（赤系）

#### 2. 府省庁ビュー（Ministry View）
- **特徴**: 特定府省庁の全事業と支出先を詳細表示
- **ナビゲーション**:
  - 全体ビューで府省庁ノードをクリック
  - 事業TopNセレクター: 事業を予算額順でページネーション表示
- **事業選択**: 予算額（totalBudget）でソート
- **色**: 予算ノード（緑系）、支出ノード（赤系）

#### 3. 事業ビュー（Project View）
- **特徴**: 個別事業の支出内訳を詳細表示（TopNデフォルト20）
- **構造**: 事業（予算）→ 事業（支出）→ 支出先（府省庁ノードは非表示）
- **ナビゲーション**: 府省庁ビューまたは全体ビューで事業ノードをクリック
- **色**: 予算ノード（緑系）、支出ノード（赤系）

#### 4. 支出ビュー（Spending View）
- **特徴**: 受給者への全資金源を4列で表示（支出元TopNデフォルト15）
  - Column 0: 府省庁予算ノード（緑）
  - Column 1: 事業予算ノード（緑）+ 事業(TopN以外)予算ノード
  - Column 2: 事業支出ノード（赤）+ 事業(TopN以外)支出ノード
  - Column 3: 受給者ノード（赤）
- **ナビゲーション**: 任意のビューで受給者ノードをクリック、または事業一覧モーダルの支出先列をクリック
- **色**: 予算ノード（緑系）、支出ノード（赤系）で予算から支出への流れを明示

### 重要な設計ポイント

1. **階層的ドリルダウンナビゲーション**
   - 府省庁TopNセレクター: `drilldownLevel`パラメータで管理（0: Top1-10, 1: Top11-20, ...）
   - 事業TopNセレクター: `projectDrilldownLevel`パラメータで管理
   - URLパラメータ: `?drilldownLevel=1&ministry=防衛省&projectDrilldownLevel=2`
   - ブラウザの戻る/進むボタンで状態復元

2. **「その他」ノードと「支出先(TopN以外)」ノードの分離**
   - **「その他」ノード**: 支出先名が「その他」である全事業からの支出を集約（約26兆円）
   - **「支出先(TopN以外)」ノード**: TopN以外の支出先 + 事業(TopN以外) + 府省庁(TopN以外)（約51兆円）
   - 両者は独立した最終ノードで、相互にリンクは存在しない

3. **TopN選択アルゴリズム**
   - **全体ビュー**: 府省庁を予算額順でソート
   - **府省庁ビュー**: 事業を予算額（totalBudget）順でソート（支出TopN貢献度から変更）
   - **事業ビュー**: 支出先を支出額順でソート
   - **支出ビュー**: 支出元事業を寄与額順でソート
   - 支出先選択時に「その他」を事前除外してTopNを選択

4. **予算0円で支出がある事業の扱い**
   - ノード値: ダミー値0.001円を使用（表示では0円と表示）
   - リンク値: 同様にダミー値0.001円
   - 理由: Sankey図でノードを表示するため（値0だと非表示になる）
   - 例: 経済産業省グリーンイノベーション基金事業

5. **URL状態管理**
   - すべてのビュー状態（選択府省庁、事業、受給者、TopN設定、drilldownLevel）をURLクエリパラメータに保存
   - ページリロード、ブックマーク、共有が可能
   - ブラウザの戻る/進むボタンに完全対応
   - `searchParams`を依存配列に含めてpopstateイベントに対応

6. **金額フォーマット仕様**
   - **整数部3桁以上**: 小数表示なし（例: `123兆円`）
   - **整数部2桁以下**: 小数第一位まで表示（例: `12.3兆円`, `1.2兆円`）
   - **1円表示**: 小数表示なし（例: `12,345円`）

## セットアップ

### 前提条件

- Node.js 18以上
- Python 3.x
- pip3

### 1. リポジトリのクローン

```bash
git clone https://github.com/team-mirai-volunteer/rs-vis.git
cd rs-vis
```

### 2. 依存パッケージのインストール

```bash
# Node.js依存関係
npm install

# Python依存関係（正規化ライブラリ）
pip3 install neologdn
```

### 3. CSVデータの準備と正規化

[行政事業レビューシステム](https://rssystem.go.jp/download-csv/2024)からZIPファイルをダウンロードし、`data/download/RS_2024/` に配置してください。

```bash
npm run normalize
```

このコマンドは以下の処理を自動実行します:

1. **ZIP解凍**: `data/download/RS_2024/` 内の全ZIPファイルを解凍
2. **CSV正規化**: 解凍したCSVファイルを正規化
   - neologdnによる正規化（最優先）
   - 丸数字の変換（①→1）
   - Unicode NFKC正規化
   - 和暦→西暦変換
   - 全角括弧→半角括弧変換
   - ハイフン・長音記号の統一
   - 連続空白の削除
3. **出力**: 正規化されたCSVを `data/year_2024/` にUTF-8形式で保存
4. **クリーンアップ**: `data/download/RS_2024/` 内のZIP以外のファイルを削除

### 4. 構造化JSONデータの生成

```bash
npm run generate-structured
```

このコマンドは `public/data/rs2024-structured.json` を生成します。
- 府省庁・事業・支出先の階層構造を保持
- 予算情報（当初予算、補正予算、繰越等）を統合
- 支出情報と関連付け
- ファイルサイズ: 約46MB

### 5. プリセットTop3サンキー図データの生成

```bash
npm run generate-preset
```

このコマンドは `public/data/rs2024-preset-top3.json` を生成します。
- Top3再帰選択によるサンキー図データ
- ノード数: 45、リンク数: 61
- カバー率: 約50%（73.58兆円 / 146.63兆円）
- ファイルサイズ: 約32KB

### 6. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3002](http://localhost:3002) を開いてください。

---

### クイックセットアップ（初回）

依存関係のインストールから正規化・JSON生成まで一括実行:

```bash
npm run setup
```

このコマンドは以下を自動実行します:
1. `npm install` - 依存パッケージのインストール
2. `npm run normalize` - CSVファイルの正規化
3. `npm run generate-structured` - 構造化JSONの生成
4. `npm run generate-preset` - プリセットTop3サンキー図データの生成

**注意**: 事前に `data/download/RS_2024/` にZIPファイルを配置し、Python 3とneologdnをインストールしてください。

## プロジェクト構成

```
rs-vis/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # ルートレイアウト
│   ├── page.tsx                 # ホーム画面（リダイレクト）
│   ├── sankey/
│   │   └── page.tsx             # サンキー図メインページ（状態管理、ビュー制御）
│   ├── api/sankey/
│   │   └── route.ts             # サンキー図データAPI（動的生成）
│   └── lib/
│       └── sankey-generator.ts  # サンキー図データ生成ロジック
├── client/                      # クライアントコンポーネント
│   ├── components/
│   │   ├── ProjectListModal.tsx    # 事業一覧モーダル
│   │   ├── SpendingListModal.tsx   # 支出先一覧モーダル
│   │   ├── SummaryDialog.tsx       # サマリーダイアログ
│   │   └── TopNSettingsPanel.tsx   # TopN設定パネル
│   ├── hooks/
│   │   └── useTopNSettings.ts   # TopN設定カスタムフック
│   └── lib/
│       ├── buildHierarchyPath.ts # 組織階層パス構築
│       └── formatBudget.ts      # 金額フォーマット
├── scripts/                     # データ生成スクリプト
│   ├── normalize_csv.py         # CSV正規化（Python + neologdn）
│   ├── csv-reader.ts            # CSV読み込み（UTF-8/Shift_JIS対応）
│   ├── generate-structured-json.ts  # 構造化JSON生成
│   ├── generate-preset-json.ts      # プリセットTop3サンキー図生成
│   ├── decompress-data.sh       # ビルド時データ展開スクリプト
│   └── debug-sankey.ts          # デバッグ用スクリプト
├── types/                       # TypeScript型定義
│   ├── structured.ts            # 構造化データ型定義
│   ├── preset.ts                # プリセットデータ型定義
│   ├── sankey.ts                # サンキー図型定義
│   └── rs-system.ts             # 元CSVデータ型定義
├── data/                        # データディレクトリ（.gitignore）
│   ├── download/RS_2024/        # 手動ダウンロードしたZIPファイル
│   └── year_2024/               # 正規化済みCSV
├── public/data/                 # 生成JSONファイル
│   ├── rs2024-structured.json.gz # 構造化データ（gzip圧縮、5.9MB）※Gitに含む
│   ├── rs2024-structured.json   # 構造化データ（展開後、46MB）※.gitignore
│   └── rs2024-preset-top3.json  # Top3サンキー図データ（約32KB）
└── CLAUDE.md                    # Claude Code使用ガイド
```

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run setup` | 初回セットアップ（install + normalize + generate-structured + generate-preset） |
| `npm run normalize` | CSVファイルを正規化（Python 3.x + neologdn必須） |
| `npm run generate-structured` | 構造化JSONファイル生成（rs2024-structured.json） |
| `npm run generate-preset` | プリセットTop3サンキー図JSON生成（rs2024-preset-top3.json） |
| `npm run compress-data` | 構造化JSONをgzip圧縮（rs2024-structured.json.gz） |
| `npm run dev` | 開発サーバー起動（Turbopack有効、ポート3002） |
| `npm run build` | プロダクションビルド（自動的にprebuildでデータ展開） |
| `npm start` | プロダクションサーバー起動 |
| `npm run lint` | ESLintによるコードチェック |

## ビルドとデプロイ

### プロダクションビルド

```bash
npm run build
npm start
```

### Vercelへのデプロイ

#### 前提条件

- Vercel CLIのインストール: `npm i -g vercel`
- GitHubリポジトリとの連携
- `public/data/rs2024-structured.json.gz`（約5.9MB）が生成済み

#### デプロイ手順

1. **Vercel CLIでログイン**
```bash
vercel login
```

2. **初回デプロイ**
```bash
vercel
```
プロジェクト名やチーム設定を確認し、デプロイを実行します。

3. **本番デプロイ**
```bash
vercel --prod
```

#### Vercel ダッシュボードからのデプロイ

1. [Vercel Dashboard](https://vercel.com/dashboard) にアクセス
2. 「Import Project」をクリック
3. GitHubリポジトリ `team-mirai-volunteer/rs-vis` を選択
4. ビルド設定:
   - **Framework Preset**: Next.js
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`
5. 「Deploy」をクリック

#### 環境変数（必要に応じて）

Vercelのプロジェクト設定で以下を設定:
- `NODE_ENV`: `production`

#### 重要な注意事項

**データファイルについて**:
- `rs2024-structured.json`（46MB）は`.gitignore`で除外されています
- **gzip圧縮版** `rs2024-structured.json.gz`（5.9MB）をGitリポジトリに含めています
- ビルド時に自動的に展開されます（`prebuild`スクリプト）

**デプロイフロー**:
1. `npm run build`が実行される
2. `prebuild`スクリプトが自動実行され、`.gz`ファイルを展開
3. Next.jsビルドが実行される
4. デプロイ完了

**データ更新時の手順**:
```bash
npm run generate-structured  # 構造化JSON生成
npm run compress-data         # gzip圧縮
git add public/data/rs2024-structured.json.gz
git commit -m "Update structured data"
git push
```

## トラブルシューティング

### neologdnがインストールされていない

```
⚠️  neologdn がインストールされていません
```

→ `pip3 install neologdn` を実行してください。

### ZIPファイルが見つからない

```
⚠️  ZIPファイルが見つかりません
```

→ `data/download/RS_2024/` にZIPファイルを配置し、`npm run normalize` を実行してください。

### データ読み込みエラー

```
データの読み込みに失敗しました (404)
```

→ 以下のコマンドを実行してJSONファイルを生成してください:
```bash
npm run generate-structured
npm run generate-preset
```

## データ統計（2024年度）

### 元データ（CSV）
- 組織情報: 8,537件
- 予算情報: 37,981件（うち2024年度: 15,111件）
- プロジェクト数: 15,111件
- 支出情報: 194,133件
- 支出先数: 25,892件

### サンキー図統計（全体ビュー・デフォルト設定）
- 総予算額: 146.63兆円
- デフォルト設定: 府省庁Top10, 支出先Top10
- カバー率: 変動（TopN設定による）
- Top3府省庁: 厚生労働省、国土交通省、デジタル庁
- Top10支出先: 地方公共団体、その他、独立行政法人など
- 「その他」ノード: 約26兆円（全事業からの支出先名「その他」への支出）
- 「支出先(TopN以外)」ノード: 約51兆円（TopN以外 + 事業(TopN以外) + 府省庁(TopN以外)）

## データソース

- [行政事業レビューシステム](https://rssystem.go.jp/)
- [2024年度CSVダウンロード](https://rssystem.go.jp/download-csv/2024)

## 📝 ライセンス

このプロジェクトは [GNU Affero General Public License](LICENSE) の下で公開されています。
データソース: [行政事業レビューシステム](https://rssystem.go.jp/)
