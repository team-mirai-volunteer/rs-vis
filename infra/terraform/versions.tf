# Terraform / プロバイダのバージョン固定。
# Vercel: 公式プロバイダ（vercel/vercel）
# Supabase: 公式プロバイダ（supabase/supabase）— 将来のDB導入に向けた先行整備

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.5"
    }
  }

  # state はまずローカル管理で開始する。チーム運用に乗せる際は
  # Terraform Cloud / S3 + DynamoDB / GCS などのリモートバックエンドへ移行すること。
  # backend "remote" { ... }
}
