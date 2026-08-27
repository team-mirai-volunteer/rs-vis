# Supabase プロジェクト（将来のDB導入に向けた先行整備）。
# アプリは現状 Supabase 未使用のため、var.supabase_enabled = true にしたときだけ作成される。
#
# 有効化の手順:
#   1. TF_VAR_supabase_organization_id と TF_VAR_supabase_database_password を設定
#   2. terraform apply -var 'supabase_enabled=true'
#   3. anon key / service_role key はダッシュボード（または supabase_apikeys データソース）から取得し、
#      app_env_sensitive 経由で Vercel に配布する

resource "supabase_project" "db" {
  count = var.supabase_enabled ? 1 : 0

  organization_id   = var.supabase_organization_id
  name              = var.supabase_project_name
  database_password = var.supabase_database_password
  region            = var.supabase_region

  lifecycle {
    # パスワードは作成後にダッシュボード側で変更されても差分にしない
    ignore_changes = [database_password]
  }
}
