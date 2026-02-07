CREATE TABLE "conversation_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"summarized_message_count" integer NOT NULL,
	"summarized_up_to_message_id" uuid,
	"original_token_count" integer NOT NULL,
	"summary_token_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summaries_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "tool_call_id" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_summarized_up_to_message_id_messages_id_fk" FOREIGN KEY ("summarized_up_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_user_id_created_at_idx" ON "messages" USING btree ("user_id","created_at");