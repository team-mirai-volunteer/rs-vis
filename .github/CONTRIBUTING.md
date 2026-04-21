# コントリビューションガイド

このプロジェクトへのコントリビューションに興味を持っていただき、ありがとうございます！

## 開発フロー

### 1. Issue作成
- バグ報告や機能リクエストはまずIssueを作成してください
- 既存のIssueを確認し、重複を避けてください
- Issue テンプレートを使用してください

### 2. ブランチ作成
```bash
# 最新のmainブランチから作業ブランチを作成
git checkout main
git pull origin main
git checkout -b feature/issue-番号-brief-description
# または
git checkout -b fix/issue-番号-brief-description
```

ブランチ命名規則:
- `feature/` - 新機能
- `fix/` - バグ修正
- `docs/` - ドキュメント更新
- `refactor/` - リファクタリング
- `test/` - テスト追加・修正

### 3. 開発
```bash
# 開発環境起動
npm run dev

# コード変更後
npm run lint  # リンターチェック
npm run build # ビルド確認
```

### 4. コミット
コミットメッセージ規約:
```
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

Type:
- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント更新
- `style`: コードフォーマット
- `refactor`: リファクタリング
- `test`: テスト追加・修正
- `chore`: ビルドプロセスやツールの変更

### 5. Pull Request作成
```bash
# リモートにプッシュ
git push origin feature/issue-番号-brief-description
```

- PRテンプレートに従って記入
- 関連IssueをリンクするClosesキーワードを使用 (`Closes #123`)
- レビューを待つ

## コーディング規約

### TypeScript
- 厳格な型定義を使用
- `any` の使用は最小限に
- 関数には適切な型注釈を付ける

### React
- 関数コンポーネントを使用
- カスタムフックで状態ロジックを分離
- 適切にuseEffect依存配列を設定

### CSS/Tailwind
- Tailwind CSSのユーティリティクラスを優先
- ダークモード対応を忘れずに (`dark:` prefix)

## データ更新手順

CSVデータを更新する場合:
```bash
# 1. ZIPファイルをdata/download/RS_2024/に配置
# 2. 正規化実行
npm run normalize

# 3. 構造化JSON生成
npm run generate-structured

# 4. プリセット生成
npm run generate-preset

# 5. データ圧縮
npm run compress-data

# 6. コミット
git add public/data/rs2024-structured.json.gz
git commit -m "chore: update RS2024 data"
```

## 質問・サポート

質問や提案がある場合は、GitHubのIssuesで気軽にお尋ねください。
