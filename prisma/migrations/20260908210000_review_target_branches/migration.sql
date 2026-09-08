ALTER TABLE "review_settings"
ADD COLUMN "target_branches" TEXT[] NOT NULL DEFAULT ARRAY['developer']::TEXT[];
