# rs-vis (Government Visualization Project)

2024年度 行政事業レビューシステムの予算・支出データを可視化するプロジェクトです。
Next.js と Nivo を使用して、複雑な予算フローをインタラクティブなサンキー図などで表現します。

## 🚀 機能

- **サンキー図（Top3）**: 府省庁 → 事業 → 支出先の予算フローを、各階層でTop3を再帰的に選択して可視化します。
- **レスポンシブデザイン**: PCおよびモバイル端末に対応。
- **ダークモード対応**: システム設定に合わせて自動的に切り替わります。

## 🛠️ 技術スタック

- **Frontend**: Next.js 15, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Visualization**: @nivo/sankey
- **Data Processing**: Python 3 (pandas, neologdn), TypeScript (tsx)

## 📦 セットアップ

### 前提条件

- Node.js (v18以上推奨)
- Python 3 (データ正規化用)
- `pip3 install neologdn` (日本語テキスト正規化用)

### インストールとデータ準備

1. リポジトリをクローンします。
2. 依存関係をインストールします。
   ```bash
   npm install
   ```
3. データ準備:
   - [行政事業レビューシステム](https://rssystem.go.jp/download-csv/2024) から2024年度のデータをダウンロードします。
   - `data/download/RS_2024/` ディレクトリを作成し、ダウンロードしたZIPファイルを配置します。
4. セットアップスクリプトを実行します（データの正規化と生成を行います）。
   ```bash
   npm run setup
   ```
   ※ `npm run setup` は以下のコマンドを順に実行します:
   - `npm install`
   - `npm run normalize` (CSV正規化)
   - `npm run generate-sankey` (サンキー図用データ生成)

### データファイルの圧縮解除

生成されたJSONデータは圧縮された状態（`.gz`形式）で保存されています。開発サーバー起動時に自動的に解凍されますが、手動で解凍する場合は以下のコマンドを実行してください。

```bash
npm run decompress
# または
./scripts/decompress-data.sh
```

このコマンドは `public/data/*.json.gz` ファイルを解凍し、同じディレクトリに `.json` ファイルを生成します。

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いて確認してください。

## 📁 ディレクトリ構造

- `app/`: Next.js アプリケーションコード
- `components/`: React コンポーネント
- `data/`: データファイル
  - `download/`: ダウンロードした生データ (ZIP)
  - `year_2024/`: 正規化されたCSVデータ
- `public/data/`: アプリケーションで使用するJSONデータ
- `scripts/`: データ処理用スクリプト (Python, TypeScript)

## 📝 ライセンス

このプロジェクトは [GNU Affero General Public License](LICENSE) の下で公開されています。
データソース: [行政事業レビューシステム](https://rssystem.go.jp/)
