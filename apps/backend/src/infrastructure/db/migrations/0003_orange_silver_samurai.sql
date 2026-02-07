CREATE TABLE "monitored_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"trigger_type" varchar(100) NOT NULL,
	"toolkit" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"parsed_context" jsonb NOT NULL,
	"orchestrator_run_id" uuid,
	"source_reply_id" varchar(255),
	"source_reply_content" text,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "orchestrator_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'idle' NOT NULL,
	"plan_id" uuid,
	"active_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"loop_counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_interventions" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrator_states_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(500) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_priority_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slack_user_id" varchar(100) NOT NULL,
	"slack_user_name" varchar(255),
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_node_id" uuid NOT NULL,
	"agent_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'initializing' NOT NULL,
	"task_description" text NOT NULL,
	"upstream_context" text,
	"additional_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_guidance" text,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "task_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"description" text NOT NULL,
	"agent_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_agent_id" uuid,
	"result" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "task_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'planning' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger_id" varchar(255) NOT NULL,
	"trigger_type" varchar(100) NOT NULL,
	"toolkit" varchar(50) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trigger_subscriptions_trigger_id_unique" UNIQUE("trigger_id")
);
--> statement-breakpoint
CREATE TABLE "user_tool_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tool_id" varchar(255) NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitored_events" ADD CONSTRAINT "monitored_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitored_events" ADD CONSTRAINT "monitored_events_subscription_id_trigger_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."trigger_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_states" ADD CONSTRAINT "orchestrator_states_plan_id_task_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."task_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_priority_contacts" ADD CONSTRAINT "slack_priority_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_agents" ADD CONSTRAINT "sub_agents_task_node_id_task_nodes_id_fk" FOREIGN KEY ("task_node_id") REFERENCES "public"."task_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_nodes" ADD CONSTRAINT "task_nodes_plan_id_task_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."task_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_subscriptions" ADD CONSTRAINT "trigger_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tool_permissions" ADD CONSTRAINT "user_tool_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitored_events_user_received_idx" ON "monitored_events" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "monitored_events_status_idx" ON "monitored_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_user_token_idx" ON "push_tokens" USING btree ("user_id","token");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_priority_contacts_user_slack_idx" ON "slack_priority_contacts" USING btree ("user_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "trigger_subscriptions_user_id_idx" ON "trigger_subscriptions" USING btree ("user_id");