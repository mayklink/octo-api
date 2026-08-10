-- Organization model policy (allowed models + default model per organization)
ALTER TABLE "organizations" ADD COLUMN "allowed_models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "organizations" ADD COLUMN "default_model" TEXT;
