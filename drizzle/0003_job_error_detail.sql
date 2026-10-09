ALTER TABLE "jobs" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;