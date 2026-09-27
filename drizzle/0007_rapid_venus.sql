ALTER TABLE "llm_usage" ADD COLUMN "origin" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage" DROP CONSTRAINT "llm_usage_user_id_day_model_pk";--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_day_model_origin_pk" PRIMARY KEY("user_id","day","model","origin");
