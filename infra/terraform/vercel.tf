# Vercel プロジェクト本体。
#
# ビルド設定・リージョン・ヘッダは既にリポジトリの vercel.json で宣言されているため、
# ここではプロジェクトの存在・Git 連携・環境変数を IaC 管理の対象とする
# （vercel.json とこのファイルの二重定義を避ける方針。詳細は README を参照）。
#
# 既存プロジェクトを取り込む場合は削除・再作成にならないよう必ず import すること:
#   terraform import vercel_project.app <project_id>

resource "vercel_project" "app" {
  name      = var.vercel_project_name
  framework = "nextjs"

  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = var.production_branch
  }

  resource_config = {
    function_default_regions = [var.vercel_function_region]
  }

  # VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL などのシステム環境変数をビルドに渡す。
  # 渡さないと app/lib/site-url.ts が localhost:3000 に落ち、OGP・canonical・sitemap の絶対URLが壊れる
  # （2026-09-25 に本番の og:image が http://localhost:3000/og/*.png になっているのを確認）
  automatically_expose_system_environment_variables = true

  # 公開サイトのため Deployment Protection（Vercel SSO）を無効化する。
  # チームの既定は「standard_protection」= 本番以外を SSO 保護だが、本番 URL も 302 で SSO へ飛ぶため none にする
  vercel_authentication = {
    deployment_type = "none"
  }
}

# ── カスタムドメイン（本番） ──
resource "vercel_project_domain" "app" {
  for_each = toset(var.custom_domains)

  project_id = vercel_project.app.id
  domain     = each.value
}

# ── 環境変数（本番・プレビュー共通） ──
# Vercel API は空リストを BAD_REQUEST で拒否するため、1件以上あるときだけリソースを作る
locals {
  app_env_variables = concat(
    [for k, v in var.app_env_plain : {
      key       = k
      value     = v
      target    = ["production", "preview"]
      sensitive = false
    }],
    [for k, v in var.app_env_sensitive : {
      key       = k
      value     = v
      target    = ["production", "preview"]
      sensitive = true
    }],
    # 本番の公開URL（OGP・canonical・sitemap の絶対URL基準）。カスタムドメインの先頭から作り、ソースには直書きしない。
    # プレビューは VERCEL_URL（上の automatically_expose_system_environment_variables）に任せる
    length(var.custom_domains) > 0 ? [
      {
        key       = "NEXT_PUBLIC_SITE_URL"
        value     = "https://${var.custom_domains[0]}"
        target    = ["production"]
        sensitive = false
      },
    ] : [],
    # Supabase を有効化したら接続情報を自動で配布する
    # （変数名は docs/tasks/20260828_1508 事業コメント機能設計 に合わせる）
    var.supabase_enabled ? [
      {
        key       = "NEXT_PUBLIC_SUPABASE_URL"
        value     = "https://${supabase_project.db[0].id}.supabase.co"
        target    = ["production", "preview"]
        sensitive = false
      },
      {
        key       = "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        value     = data.supabase_apikeys.db[0].anon_key
        target    = ["production", "preview"]
        sensitive = false
      },
      {
        key       = "SUPABASE_SERVICE_ROLE_KEY"
        value     = data.supabase_apikeys.db[0].service_role_key
        target    = ["production", "preview"]
        sensitive = true
      },
    ] : [],
  )
}

resource "vercel_project_environment_variables" "app" {
  count = length(local.app_env_variables) > 0 ? 1 : 0

  project_id = vercel_project.app.id
  variables  = local.app_env_variables
}
