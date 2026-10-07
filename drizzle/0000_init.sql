CREATE TYPE "public"."actor_type" AS ENUM('staff', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."intent" AS ENUM('new_idea', 'feedback', 'approval', 'persona_preference', 'question', 'other');--> statement-breakpoint
CREATE TYPE "public"."persona_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('awaiting_input', 'drafting', 'pending_approval', 'changes_requested', 'approved', 'missed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'subadmin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'onboarding', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."wa_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."wa_status" AS ENUM('received', 'queued', 'sent', 'failed', 'emailed');--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cadences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"posts_per_week" integer NOT NULL,
	"weekdays" integer[] NOT NULL,
	"times" text[] NOT NULL,
	"monthly_cap" integer DEFAULT 20 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid,
	"kind" text NOT NULL,
	"before" text NOT NULL,
	"after" text,
	"feedback" text,
	"consumed_in_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "golden_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid,
	"input" text NOT NULL,
	"post" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent" "intent",
	"extracted_json" jsonb,
	"slot_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"vision_description" text,
	"consent_flag" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"text" text,
	"audio_url" text,
	"transcript" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"status" "persona_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"text" text NOT NULL,
	"media" uuid[] DEFAULT '{}' NOT NULL,
	"persona_version" integer,
	"prompt_version" text,
	"model" text,
	"created_by" text NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slot_id" uuid,
	"bundle_id" uuid,
	"status" "post_status" DEFAULT 'drafting' NOT NULL,
	"current_version_id" uuid,
	"suggested_topic" boolean DEFAULT false NOT NULL,
	"topic" text,
	"summary" text,
	"first_comment" text,
	"review_issues" jsonb,
	"flagged_for_staff" boolean DEFAULT false NOT NULL,
	"staff_approved_by" uuid,
	"staff_approved_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"publish_at" timestamp with time zone,
	"publish_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preview_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"needs_totp" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"approval_deadline" timestamp with time zone NOT NULL,
	"status" "post_status" DEFAULT 'awaiting_input' NOT NULL,
	"post_id" uuid,
	"is_extra" boolean DEFAULT false NOT NULL,
	"topic_prompt_sent_at" timestamp with time zone,
	"auto_draft_at" timestamp with time zone,
	"reminder1_at" timestamp with time zone,
	"reminder2_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"totp_secret" text,
	"totp_pending" text,
	"can_invite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "subadmin_accounts" (
	"staff_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subadmin_accounts_staff_id_user_id_pk" PRIMARY KEY("staff_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tone_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"text" text NOT NULL,
	"persona_version" integer NOT NULL,
	"verdict" text,
	"comment" text,
	"rounds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"org" text,
	"specialty" text,
	"linkedin_url" text,
	"photo_url" text,
	"phone_e164" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	"languages" text[] DEFAULT '{"en"}' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"staff_approval_is_final" boolean DEFAULT false NOT NULL,
	"whatsapp_verified_at" timestamp with time zone,
	"whatsapp_verify_code" text,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_e164" text NOT NULL,
	"direction" "wa_direction" NOT NULL,
	"status" "wa_status" NOT NULL,
	"wa_message_id" text,
	"type" text NOT NULL,
	"body" text,
	"media_url" text,
	"transcript" text,
	"bundle_id" uuid,
	"raw_json" jsonb,
	"kind" text,
	"send_after" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"email_fallback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writing_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cadences" ADD CONSTRAINT "cadences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_pairs" ADD CONSTRAINT "edit_pairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_candidates" ADD CONSTRAINT "golden_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_bundles" ADD CONSTRAINT "input_bundles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_answers" ADD CONSTRAINT "onboarding_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_tokens" ADD CONSTRAINT "preview_tokens_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subadmin_accounts" ADD CONSTRAINT "subadmin_accounts_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subadmin_accounts" ADD CONSTRAINT "subadmin_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tone_samples" ADD CONSTRAINT "tone_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_user_created" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_tokens_actor_idx" ON "login_tokens" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_answers_user_q" ON "onboarding_answers" USING btree ("user_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_user_version" ON "personas" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "posts_user_status" ON "posts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "slots_user_publish" ON "slots" USING btree ("user_id","publish_at");--> statement-breakpoint
CREATE INDEX "slots_status_deadline" ON "slots" USING btree ("status","approval_deadline");--> statement-breakpoint
CREATE INDEX "wa_messages_user_created" ON "wa_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_wa_id" ON "wa_messages" USING btree ("wa_message_id");--> statement-breakpoint
CREATE INDEX "wa_messages_outbox" ON "wa_messages" USING btree ("direction","status","send_after");