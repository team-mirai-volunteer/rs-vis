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

  serverless_function_region = var.vercel_function_region
}

# ── 環境変数（本番・プレビュー共通） ──
resource "vercel_project_environment_variables" "app" {
  project_id = vercel_project.app.id

  variables = concat(
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
    # Supabase を有効化したら接続情報を自動で配布する
    var.supabase_enabled ? [
      {
        key       = "NEXT_PUBLIC_SUPABASE_URL"
        value     = "https://${supabase_project.db[0].id}.supabase.co"
        target    = ["production", "preview"]
        sensitive = false
      },
    ] : [],
  )
}
