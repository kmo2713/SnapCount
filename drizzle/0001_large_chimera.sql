CREATE TABLE "player_projections" (
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"player_id" text NOT NULL,
	"company" text,
	"stats" jsonb NOT NULL,
	"pts_ppr" real,
	"pts_half_ppr" real,
	"pts_std" real,
	"opponent" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_projections_season_week_player_id_pk" PRIMARY KEY("season","week","player_id")
);
--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_projections_week_idx" ON "player_projections" USING btree ("season","week");