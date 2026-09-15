# インフラ IaC（Terraform: Vercel + Supabase）

このディレクトリは、marumie-rssystem のデプロイ先インフラを Terraform で宣言管理するための構成。

## 管理対象と非対象

| 対象 | 管理方法 |
|------|---------|
| Vercel プロジェクトの存在・GitHub連携・Functionsリージョン・カスタムドメイン・Deployment Protection | ここ（`vercel.tf`） |
| Vercel の環境変数（本番・プレビュー） | ここ（`vercel.tf` + tfvars/TF_VAR） |
| ビルドコマンド・ヘッダ・regions | リポジトリの `vercel.json`（アプリと同居のまま） |
| Supabase プロジェクト（将来のDB） | ここ（`supabase.tf`、`supabase_enabled=true` で作成） |
| 既存コメントテーブルの非公開列の権限修正 | `comment-privacy.tf` → `scripts/apply-comment-privacy.mjs` → Management API |

`vercel.json` はデプロイごとにコードと一緒にバージョン管理される「アプリの設定」、
Terraform は「プロジェクトそのものと秘匿値」という役割分担。二重定義しないこと。

## 現状（2026-09-12）

- Vercel: チーム `team-mirai`（slug）にプロジェクト `marumie-rssystem` を Terraform で作成済み
  （`prj_xRZPq22PXHNpf8zvDLtDZOFILr7e`、GitHub `team-mirai-volunteer/rs-vis` の `main` に連携）。
  本番ドメインは `rs-vis.team-mir.ai`（`vercel_project_domain`。team-mir.ai はチーム登録済みで DNS も
  Vercel 管理・ワイルドカード ALIAS あり、レコード追加は不要）。Deployment Protection は公開サイトのため無効。
- Supabase: org `team-mirai`（`drotyunmgutoaowxzpya`）にプロジェクト `marumie-rssystem`
  （ref `igtulishrosqdukrrixx`、ap-northeast-1）を作成済み。URL / anon key / service_role key は
  Terraform が Vercel 環境変数（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`）へ自動配布する。既存コメントテーブルへの権限修正は下記手順で適用する。
- state はこの Terraform を実行したマシンのローカルにのみ存在する。別マシンで操作する場合は
  `terraform import vercel_project.app prj_xRZPq22PXHNpf8zvDLtDZOFILr7e` と
  `terraform import 'supabase_project.db[0]' igtulishrosqdukrrixx` から始めること。

## 日常の操作

```bash
winget install Hashicorp.Terraform   # 未導入なら（または choco install terraform）
cd infra/terraform
export VERCEL_API_TOKEN=...          # https://vercel.com/account/tokens（Scope は team-mirai）
export SUPABASE_ACCESS_TOKEN=...     # Supabase 無効でもプロバイダが必須とするため、未使用時はダミー文字列でよい
cp terraform.tfvars.example terraform.tfvars   # 初回のみ
terraform init
terraform plan
terraform apply
```

注意: 環境変数が 0 件のとき Vercel API は BAD_REQUEST を返すため、
`vercel_project_environment_variables.app` は `count` で 1 件以上あるときだけ作成される。

```bash
cd infra/terraform
export VERCEL_API_TOKEN=...        # https://vercel.com/account/tokens
cp terraform.tfvars.example terraform.tfvars   # 値を編集
terraform init
```

### 既存の Vercel プロジェクトを取り込む（重要）

既にダッシュボードで作成済みのプロジェクトがあるため、**apply の前に必ず import する**。
import せずに apply すると同名プロジェクトの新規作成を試みて失敗、または二重作成になる。

```bash
# プロジェクトIDは Vercel ダッシュボード → Settings → General で確認（prj_ で始まる）
terraform import vercel_project.app prj_XXXXXXXXXXXX
terraform plan   # 差分が「変更なし or 意図した差分のみ」であることを確認してから apply
```

環境変数を既にダッシュボードで設定済みの場合は `vercel_project_environment_variables.app[0]` も
import するか、いったんダッシュボード側を空にしてから Terraform で入れ直す。

## Supabase の有効化（DB導入時）

```bash
export SUPABASE_ACCESS_TOKEN=...                 # https://supabase.com/dashboard/account/tokens
export TF_VAR_supabase_database_password=...     # 強いパスワードを生成して渡す
terraform apply -var 'supabase_enabled=true' \
  -var 'supabase_organization_id=<org-id>'
```

作成後、anon key / service_role key をダッシュボードから取得し、
`app_env_sensitive` に `NEXT_PUBLIC_SUPABASE_ANON_KEY` 等として追加 → 再 apply で Vercel に配布する。
`NEXT_PUBLIC_SUPABASE_URL` は有効化時に自動で Vercel へ設定される。

## コメントの非公開列をTerraformから修正する

`terraform_data.comment_privacy` は、既存の `public.project_comments` に対して、
修正SQLと権限検証SQLを一つのトランザクションで実行する。検証失敗時はコミットしない。
SQLファイルまたは実行スクリプトのハッシュが変わった場合に再実行する。
新規DBへのテーブル作成は含まないため、初回構築では基礎スキーマを先に適用する。

必要条件：Node.js 22、Terraformを実行できる権限、既存のローカルstate、
`SUPABASE_ACCESS_TOKEN`（対象DBへの書込権限）、通常のTerraformプロバイダ認証。
トークンをチャット・コマンド引数・Terraform変数に書かず、実行プロセスの環境変数へ設定する。

```powershell
Set-Location infra/terraform
node ../../scripts/apply-comment-privacy.mjs --check
terraform init
terraform validate
terraform plan -out=comment-privacy.tfplan
# 権限修正の追加と、ほかに意図しない変更がないことを確認
terraform apply comment-privacy.tfplan
```

接続先は既存の `supabase_project.db[0].id` から取得する。plan後にSQL・検証・runnerを変更すると適用を拒否する。
`SUPABASE_ACCESS_TOKEN` はlocal-execの親環境から継承し、この追加リソースのstateやログには保存しない。
planファイルには既存構成の秘匿値が含まれ得るため、リポジトリに追加しない。

この処理は今回の権限修正専用で、汎用のmigration管理やドリフト検出ではない。
Terraformリソースの削除・置換で非公開列を再公開する処理はない。
Supabase CLIのmigration履歴には登録しない。将来CLIで同じSQLを実行しても権限修正は再適用可能。

実装根拠：[Terraformのterraform_data](https://developer.hashicorp.com/terraform/language/resources/terraform-data)、
[Supabase Management APIのSQL実行](https://supabase.com/docs/reference/api/v1-run-a-query)。

2026-09-15の作業環境ではTerraform実行がAccess is deniedとなり、管理トークンも未設定。
ローカルのrunnerテストのみ実施。本番適用・terraform validate/planは未実施。

## state の管理

現状はローカル state（`.gitignore` 済み）。複数人で運用する段階になったら
Terraform Cloud / S3 などのリモートバックエンドへ移行すること（`versions.tf` のコメント参照）。

## 秘匿値の扱い

- トークン類（`VERCEL_API_TOKEN` / `SUPABASE_ACCESS_TOKEN`）とDBパスワードは環境変数でのみ渡す
- `*.tfvars` は `.gitignore` 済み。例外は `terraform.tfvars.example` のみ（秘匿値を書かない）
- state ファイルには秘匿値が平文で入るため、リモートバックエンド移行時は暗号化を有効にする
