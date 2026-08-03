CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "RepositoryStatus" AS ENUM ('pending', 'active', 'disabled', 'error');
CREATE TYPE "CredentialKind" AS ENUM ('azure_devops_pat', 'codex_auth');
CREATE TYPE "JobSource" AS ENUM ('manual', 'webhook', 'retry');
CREATE TYPE "JobStatus" AS ENUM ('created', 'queued', 'running', 'retry_wait', 'completed', 'failed');
CREATE TYPE "AttemptStatus" AS ENUM ('created', 'published', 'running', 'retry_wait', 'completed', 'failed', 'timed_out');
CREATE TYPE "PublicationKind" AS ENUM ('finding', 'summary', 'status');
CREATE TYPE "PublicationStatus" AS ENUM ('pending', 'publishing', 'completed', 'failed');
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'processing', 'processed', 'failed');

CREATE TABLE "organizations" (
  "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "organization_members" (
  "organization_id" UUID NOT NULL, "user_id" UUID NOT NULL, "role" "MemberRole" NOT NULL DEFAULT 'member',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("organization_id", "user_id")
);
CREATE TABLE "repositories" (
  "id" UUID PRIMARY KEY, "organization_id" UUID NOT NULL, "name" TEXT NOT NULL, "provider" TEXT NOT NULL DEFAULT 'azure-devops',
  "azure_organization" TEXT NOT NULL, "azure_project_id" TEXT NOT NULL, "azure_repository_id" TEXT NOT NULL, "clone_url" TEXT NOT NULL,
  "status" "RepositoryStatus" NOT NULL DEFAULT 'pending', "webhook_secret_hash" TEXT, "webhook_secret_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "integration_credentials" (
  "id" UUID PRIMARY KEY, "organization_id" UUID NOT NULL, "repository_id" UUID, "kind" "CredentialKind" NOT NULL,
  "key_id" TEXT NOT NULL, "iv" TEXT NOT NULL, "ciphertext" TEXT NOT NULL, "auth_tag" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "last_validated_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "review_settings" (
  "repository_id" UUID PRIMARY KEY, "prompt" TEXT NOT NULL, "severity_threshold" TEXT, "model" TEXT NOT NULL,
  "auto_review" BOOLEAN NOT NULL DEFAULT true, "policy_version" TEXT NOT NULL DEFAULT 'static-review-v2', "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "pull_requests" (
  "id" UUID PRIMARY KEY, "repository_id" UUID NOT NULL, "provider_pull_request_id" TEXT NOT NULL, "title" TEXT NOT NULL, "status" TEXT NOT NULL,
  "source_branch" TEXT NOT NULL, "target_branch" TEXT NOT NULL, "source_commit" TEXT NOT NULL, "target_commit" TEXT NOT NULL, "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "review_jobs" (
  "id" UUID PRIMARY KEY, "organization_id" UUID NOT NULL, "repository_id" UUID NOT NULL, "pull_request_id" UUID NOT NULL,
  "source" "JobSource" NOT NULL, "status" "JobStatus" NOT NULL DEFAULT 'created', "correlation_id" TEXT NOT NULL UNIQUE,
  "current_attempt" INTEGER NOT NULL DEFAULT 1, "summary" JSONB, "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "review_job_attempts" (
  "id" UUID PRIMARY KEY, "review_job_id" UUID NOT NULL, "attempt" INTEGER NOT NULL, "event_id" TEXT NOT NULL UNIQUE,
  "status" "AttemptStatus" NOT NULL DEFAULT 'created', "sandbox_id" TEXT, "deadline_at" TIMESTAMP(3) NOT NULL, "next_retry_at" TIMESTAMP(3),
  "failure_code" TEXT, "failure_category" TEXT, "failure_message" TEXT, "timings" JSONB, "started_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "review_findings" (
  "id" UUID PRIMARY KEY, "review_job_id" UUID NOT NULL, "attempt_id" UUID NOT NULL, "ordinal" INTEGER NOT NULL,
  "file_path" TEXT NOT NULL, "line" INTEGER, "severity" TEXT NOT NULL, "category" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT NOT NULL, "suggestion" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "review_publications" (
  "id" UUID PRIMARY KEY, "dedup_key" TEXT NOT NULL UNIQUE, "review_job_id" UUID NOT NULL, "finding_id" UUID, "kind" "PublicationKind" NOT NULL,
  "status" "PublicationStatus" NOT NULL DEFAULT 'pending', "external_id" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT, "published_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "webhook_events" (
  "id" UUID PRIMARY KEY, "repository_id" UUID NOT NULL, "provider_event_id" TEXT NOT NULL, "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "review_job_id" UUID, "processing_at" TIMESTAMP(3), "processed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "message_inbox" (
  "event_id" TEXT PRIMARY KEY, "routing_key" TEXT NOT NULL, "status" "MessageStatus" NOT NULL DEFAULT 'processing',
  "payload" JSONB NOT NULL, "error" TEXT, "processed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "message_outbox" (
  "id" UUID PRIMARY KEY, "event_id" TEXT NOT NULL UNIQUE, "aggregate_id" UUID NOT NULL, "routing_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "status" "MessageStatus" NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "published_at" TIMESTAMP(3), "last_error" TEXT, "lease_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");
CREATE INDEX "repositories_organization_id_status_idx" ON "repositories"("organization_id", "status");
CREATE UNIQUE INDEX "repositories_azure_identity_key" ON "repositories"("organization_id", "azure_organization", "azure_project_id", "azure_repository_id");
CREATE INDEX "integration_credentials_organization_id_kind_idx" ON "integration_credentials"("organization_id", "kind");
CREATE UNIQUE INDEX "integration_credentials_scope_kind_key" ON "integration_credentials"("organization_id", "repository_id", "kind");
CREATE UNIQUE INDEX "integration_credentials_org_codex_key" ON "integration_credentials"("organization_id", "kind") WHERE "repository_id" IS NULL;
CREATE UNIQUE INDEX "pull_requests_provider_identity_key" ON "pull_requests"("repository_id", "provider_pull_request_id");
CREATE INDEX "review_jobs_organization_id_created_at_idx" ON "review_jobs"("organization_id", "created_at");
CREATE INDEX "review_jobs_repository_id_status_idx" ON "review_jobs"("repository_id", "status");
CREATE INDEX "review_job_attempts_status_next_retry_at_idx" ON "review_job_attempts"("status", "next_retry_at");
CREATE UNIQUE INDEX "review_job_attempts_job_attempt_key" ON "review_job_attempts"("review_job_id", "attempt");
CREATE INDEX "review_findings_review_job_id_severity_idx" ON "review_findings"("review_job_id", "severity");
CREATE UNIQUE INDEX "review_findings_attempt_id_ordinal_key" ON "review_findings"("attempt_id", "ordinal");
CREATE INDEX "review_publications_status_updated_at_idx" ON "review_publications"("status", "updated_at");
CREATE UNIQUE INDEX "review_publications_identity_key" ON "review_publications"("review_job_id", "finding_id", "kind");
CREATE UNIQUE INDEX "webhook_events_provider_identity_key" ON "webhook_events"("repository_id", "provider_event_id");
CREATE INDEX "message_outbox_status_available_at_idx" ON "message_outbox"("status", "available_at");

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE;
ALTER TABLE "review_settings" ADD CONSTRAINT "review_settings_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE;
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE;
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE;
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE;
ALTER TABLE "review_job_attempts" ADD CONSTRAINT "review_job_attempts_review_job_id_fkey" FOREIGN KEY ("review_job_id") REFERENCES "review_jobs"("id") ON DELETE CASCADE;
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_review_job_id_fkey" FOREIGN KEY ("review_job_id") REFERENCES "review_jobs"("id") ON DELETE CASCADE;
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "review_job_attempts"("id") ON DELETE CASCADE;
ALTER TABLE "review_publications" ADD CONSTRAINT "review_publications_review_job_id_fkey" FOREIGN KEY ("review_job_id") REFERENCES "review_jobs"("id") ON DELETE CASCADE;
ALTER TABLE "review_publications" ADD CONSTRAINT "review_publications_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "review_findings"("id") ON DELETE CASCADE;
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE;
