output "vercel_project_id" {
  description = "Vercel プロジェクト ID（import 確認や CLI 連携に使う）"
  value       = vercel_project.app.id
}

output "supabase_project_id" {
  description = "Supabase プロジェクト ID（ref）。未有効化なら null"
  value       = var.supabase_enabled ? supabase_project.db[0].id : null
}

output "supabase_url" {
  description = "Supabase API URL。未有効化なら null"
  value       = var.supabase_enabled ? "https://${supabase_project.db[0].id}.supabase.co" : null
}
