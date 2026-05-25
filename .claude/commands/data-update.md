---
allowed-tools: Bash(npm run generate-sankey-svg:*), Bash(npm run generate-sankey-svg-2025:*), Bash(npm run generate-subcontracts:*), Bash(npm run generate-subcontracts-2025:*), Bash(npm run generate-mof-data:*), Bash(npm run generate-project-details:*), Bash(npm run score-quality:*), Bash(npm run score-quality-2025:*), Bash(npm run compress-data:*), Bash(ls:*), Bash(git:*)
description: RS SystemのCSVデータを更新してJSON生成・圧縮・Gitに反映する
---

## タスク

RS System（rssystem.go.jp）のデータを更新する手順を実行する。

### 前提確認

1. **ZIPファイルの確認**: `data/download/RS_{YEAR}/` に最新のCSV ZIPファイルが配置されているか確認する。
   - 必要な代表ファイル: `1-1_RS_{YEAR}_基本情報_組織情報.zip`、`2-1_RS_{YEAR}_予算・執行_サマリ.zip`、`5-1_RS_{YEAR}_支出先_支出情報.zip`、`5-2_RS_{YEAR}_支出先_支出ブロックのつながり.zip` 等
   - ファイルがない場合は `https://rssystem.go.jp/download-csv/{YEAR}` からダウンロードするようユーザーに案内して終了する

### 実行手順

公開4ページが消費する JSON を再生成する。

2. **/sankey-svg 用**
   ```bash
   npm run generate-sankey-svg         # 2024年度
   npm run generate-sankey-svg-2025    # 2025年度
   ```

3. **/subcontracts 用**
   ```bash
   npm run generate-subcontracts       # 2024年度
   npm run generate-subcontracts-2025  # 2025年度
   ```

4. **/mof-budget-overview 用**
   ```bash
   npm run generate-mof-data
   ```

5. **/api/project-details 用**
   ```bash
   npm run generate-project-details
   ```

6. **/quality 用**
   ```bash
   npm run score-quality               # 2024年度
   npm run score-quality-2025          # 2025年度
   ```

7. **ファイルサイズ確認**: 生成された JSON の極端な小ささ（数百KB以下等）がないかユーザーに報告する。

8. **圧縮**: `npm run compress-data` で `.json` から `.gz` を再生成する。

9. **差分確認**: `git diff --stat public/data/*.gz` で変更があるか確認する。変更がない場合はユーザーに報告して終了する。

10. **コミット確認**: ユーザーに「コミット・プッシュしますか？」と確認を取る。

11. **コミット・プッシュ**（ユーザーが OK した場合のみ）:
    ```bash
    git add public/data/*.gz
    git commit -m "chore: RS System 2024/2025データを更新"
    git push origin main
    ```

## 注意事項

- `public/data/*.json`（展開後の本体）は `.gitignore` 対象、`.json.gz` のみコミットする
- コミット前に必ずユーザー確認を取ること
- Vercel へのデプロイは `git push` で自動トリガー
