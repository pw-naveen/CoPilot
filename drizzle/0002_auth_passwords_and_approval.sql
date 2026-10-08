ALTER TYPE "public"."user_status" ADD VALUE 'pending' BEFORE 'invited';--> statement-breakpoint
ALTER TYPE "public"."user_status" ADD VALUE 'rejected' BEFORE 'invited';--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rejected_reason" text;