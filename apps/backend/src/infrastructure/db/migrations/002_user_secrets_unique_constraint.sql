-- Add unique constraint on user_secrets (user_id, provider)
-- This ensures one secret per provider per user

CREATE UNIQUE INDEX IF NOT EXISTS "user_secrets_user_provider_unique" 
ON "user_secrets" ("user_id", "provider");
