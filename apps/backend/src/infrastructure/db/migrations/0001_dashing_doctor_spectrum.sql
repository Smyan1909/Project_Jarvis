CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"url" varchar(2048) NOT NULL,
	"transport" varchar(50) DEFAULT 'streamable-http' NOT NULL,
	"auth_type" varchar(50) DEFAULT 'none' NOT NULL,
	"auth_config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"connection_timeout_ms" integer DEFAULT 30000 NOT NULL,
	"request_timeout_ms" integer DEFAULT 60000 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_secrets_user_provider_idx" ON "user_secrets" USING btree ("user_id","provider");