---
allowed-tools: Bash(npm run normalize:*), Bash(npm run generate-structured:*), Bash(npm run compress-data:*), Bash(ls:*), Bash(git:*)
description: RS SystemのCSVデータを更新してJSON生成・圧縮・Gitに反映する
---

## タスク

RS System（rssystem.go.jp）のデータを更新する手順を実行してください：

### 前提確認

1. **ZIPファイルの確認**: `data/download/RS_2024/` に最新のCSV ZIPファイルが配置されているか確認する。
   - 必要なファイル: `1-1_RS_2024_基本情報_組織情報.zip`、`1-2_RS_2024_基本情報_事業概要等.zip`、`2-1_RS_2024_予算・執行_サマリ.zip`、`5-1_RS_2024_支出先_支出情報.zip`
   - ファイルがない場合はユーザーに `https://rssystem.go.jp/download-csv/2024` からダウンロードするよう案内して終了する

### 実行手順

2. **CSV正規化**: `npm run normalize` を実行する
   - エラーが出た場合: `pip3 install neologdn` が必要な可能性がある

3. **構造化JSON生成**: `npm run generate-structured` を実行する（時間がかかる場合あり）

4. **ファイルサイズ確認**: 生成されたファイルを確認する：
   - `public/data/rs2024-structured.json` のサイズ（目安: ~46MB）
   - 極端に小さい場合（1MB以下）はエラーの可能性があるためユーザーに報告する

5. **圧縮**: `npm run compress-data` を実行する
   - `public/data/rs2024-structured.json.gz` が生成される（目安: ~5.9MB）

6. **差分確認**: `git diff --stat public/data/rs2024-structured.json.gz` で変更があるか確認する。変更がない場合はユーザーに報告する。

7. **コミット確認**: ユーザーに「コミット・プッシュしますか？」と確認を取る。

8. **コミット・プッシュ**（ユーザーがOKした場合のみ）:
   ```
   git add public/data/rs2024-structured.json.gz
   git commit -m "chore: RS System 2024データを更新"
   git push origin main
   ```

9. **完了報告**: 更新内容を報告する。

## 注意事項

- `public/data/rs2024-structured.json`（46MB）は `.gitignore` に含まれているため、`.gz` のみコミットする
- コミット前に必ずユーザーの確認を取ること
- Vercelへのデプロイは `git push` で自動的にトリガーされる
