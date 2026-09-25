# A forward-only permission repair for the existing comments table.
# SQL and the assertion run in one transaction. Destroying this Terraform
# resource never restores access to the private columns.
resource "terraform_data" "comment_privacy" {
  count = var.supabase_enabled ? 1 : 0

  input = {
    project_ref         = supabase_project.db[0].id
    migration_sha256    = filesha256("${path.module}/../../supabase/migrations/20260915_comments_column_privileges.sql")
    verification_sha256 = filesha256("${path.module}/../../supabase/tests/comments_privileges.sql")
    runner_sha256       = filesha256("${path.module}/../../scripts/apply-comment-privacy.mjs")
  }

  triggers_replace = [
    supabase_project.db[0].id,
    filesha256("${path.module}/../../supabase/migrations/20260915_comments_column_privileges.sql"),
    filesha256("${path.module}/../../supabase/tests/comments_privileges.sql"),
    filesha256("${path.module}/../../scripts/apply-comment-privacy.mjs"),
  ]

  provisioner "local-exec" {
    # Run node directly instead of through cmd /C: on Windows the quoted path is mangled
    # into "infra\scripts\...mjs\"" and the runner is never found.
    interpreter = ["node"]
    command     = "${path.module}/../../scripts/apply-comment-privacy.mjs"
    environment = {
      COMMENT_PRIVACY_PROJECT_REF         = self.input.project_ref
      COMMENT_PRIVACY_MIGRATION_SHA256    = self.input.migration_sha256
      COMMENT_PRIVACY_VERIFICATION_SHA256 = self.input.verification_sha256
      COMMENT_PRIVACY_RUNNER_SHA256       = self.input.runner_sha256
    }
    # SUPABASE_ACCESS_TOKEN is inherited from the calling environment.
    # Never put it into Terraform input, state, the command line, or logs.
  }
}
