variable "vercel_team_slug" {
  description = "Vercel チームの slug（個人アカウントの場合は null のまま）"
  type        = string
  default     = null
}

variable "vercel_project_name" {
  description = "Vercel プロジェクト名"
  type        = string
  default     = "marumie-rssystem"
}

variable "github_repo" {
  description = "接続する GitHub リポジトリ（owner/name）"
  type        = string
  default     = "team-mirai-volunteer/rs-vis"
}

variable "production_branch" {
  description = "本番デプロイ対象ブランチ"
  type        = string
  default     = "main"
}

variable "vercel_function_region" {
  description = "Serverless Functions のリージョン（東京 = hnd1。vercel.json の regions と揃える）"
  type        = string
  default     = "hnd1"
}

# ── アプリの環境変数（本番/プレビュー共通で設定するもの） ──
# AIチャット等の秘匿値。tfvars に書かず TF_VAR_... 環境変数で渡すこと。
variable "app_env_sensitive" {
  description = "秘匿環境変数（key => value）。例: SANKEY_AI_CHAT_API_KEY, OPENROUTER_API_KEY"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "app_env_plain" {
  description = "非秘匿の環境変数（key => value）。例: SANKEY_AI_CHAT_ENABLED, NEXT_PUBLIC_FEATURE_AI_CHAT"
  type        = map(string)
  default     = {}
}

# ── Supabase（将来のDB導入に向けた先行整備） ──
variable "supabase_enabled" {
  description = "Supabase プロジェクトを作成するか。アプリは現状未使用のため既定は false。DB導入時に true へ"
  type        = bool
  default     = false
}

variable "supabase_organization_id" {
  description = "Supabase の organization ID（ダッシュボード URL の org スラッグ）"
  type        = string
  default     = null
}

variable "supabase_project_name" {
  description = "Supabase プロジェクト名"
  type        = string
  default     = "marumie-rssystem"
}

variable "supabase_region" {
  description = "Supabase プロジェクトのリージョン（東京 = ap-northeast-1）"
  type        = string
  default     = "ap-northeast-1"
}

variable "supabase_database_password" {
  description = "Supabase の DB パスワード。TF_VAR_supabase_database_password で渡すこと"
  type        = string
  default     = null
  sensitive   = true
}
