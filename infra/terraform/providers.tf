# 認証はトークンを tfvars に書かず、環境変数で渡す運用とする:
#   VERCEL_API_TOKEN     … https://vercel.com/account/tokens で発行
#   SUPABASE_ACCESS_TOKEN … https://supabase.com/dashboard/account/tokens で発行

provider "vercel" {
  # api_token は環境変数 VERCEL_API_TOKEN から自動で読まれる
  team = var.vercel_team_slug
}

provider "supabase" {
  # access_token は環境変数 SUPABASE_ACCESS_TOKEN から自動で読まれる
}
