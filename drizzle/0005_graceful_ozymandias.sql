CREATE TABLE "gameday_plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"event_id" text NOT NULL,
	"play_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"wallclock" timestamp with time zone NOT NULL,
	"period" integer NOT NULL,
	"clock" text NOT NULL,
	"team_abbr" text,
	"text" text NOT NULL,
	"scoring_play" boolean DEFAULT false NOT NULL,
	"impact" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gameday_plays_play_uq" ON "gameday_plays" USING btree ("play_id");--> statement-breakpoint
CREATE INDEX "gameday_plays_when_idx" ON "gameday_plays" USING btree ("season","week","wallclock");--> statement-breakpoint
CREATE INDEX "gameday_plays_event_idx" ON "gameday_plays" USING btree ("event_id");