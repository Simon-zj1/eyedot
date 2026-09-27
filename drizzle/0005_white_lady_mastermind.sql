CREATE TABLE "login_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"invite_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "login_challenges_email_idx" ON "login_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_challenges_expires_idx" ON "login_challenges" USING btree ("expires_at");