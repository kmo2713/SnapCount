CREATE TABLE "gameday_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gameday_snapshots_bucket_uq" ON "gameday_snapshots" USING btree ("season","week","bucket");--> statement-breakpoint
CREATE INDEX "gameday_snapshots_captured_idx" ON "gameday_snapshots" USING btree ("captured_at");