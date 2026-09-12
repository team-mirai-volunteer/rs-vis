# インフラ IaC（Terraform: Vercel + Supabase）

このディレクトリは、marumie-rssystem のデプロイ先インフラを Terraform で宣言管理するための構成。

## 管理対象と非対象

| 対象 | 管理方法 |
|------|---------|
| Vercel プロジェクトの存在・GitHub連携・Functionsリージョン | ここ（`vercel.tf`） |
| Vercel の環境変数（本番・プレビュー） | ここ（`vercel.tf` + tfvars/TF_VAR） |
| ビルドコマンド・ヘッダ・regions | リポジトリの `vercel.json`（アプリと同居のまま） |
| Supabase プロジェクト（将来のDB） | ここ（`supabase.tf`、`supabase_enabled=true` で作成） |

`vercel.json` はデプロイごとにコードと一緒にバージョン管理される「アプリの設定」、
Terraform は「プロジェクトそのものと秘匿値」という役割分担。二重定義しないこと。

## 現状（2026-09-12）

- Vercel: チーム `team-mirai`（slug）にプロジェクト `marumie-rssystem` を Terraform で作成済み
  （`prj_xRZPq22PXHNpf8zvDLtDZOFILr7e`、GitHub `team-mirai-volunteer/rs-vis` の `main` に連携）。
- Supabase: 未作成。`supabase_enabled=true` で作成する（下記）。
- state はこの Terraform を実行したマシンのローカルにのみ存在する。別マシンで操作する場合は
  `terraform import vercel_project.app prj_xRZPq22PXHNpf8zvDLtDZOFILr7e` から始めること。

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

## state の管理

現状はローカル state（`.gitignore` 済み）。複数人で運用する段階になったら
Terraform Cloud / S3 などのリモートバックエンドへ移行すること（`versions.tf` のコメント参照）。

## 秘匿値の扱い

- トークン類（`VERCEL_API_TOKEN` / `SUPABASE_ACCESS_TOKEN`）とDBパスワードは環境変数でのみ渡す
- `*.tfvars` は `.gitignore` 済み。例外は `terraform.tfvars.example` のみ（秘匿値を書かない）
- state ファイルには秘匿値が平文で入るため、リモートバックエンド移行時は暗号化を有効にする
