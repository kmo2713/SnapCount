CREATE TYPE "public"."credential_kind" AS ENUM('oauth2', 'cookie', 'none');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('sleeper', 'yahoo', 'espn');--> statement-breakpoint
CREATE TYPE "public"."roster_slot_kind" AS ENUM('starter', 'bench', 'ir', 'taxi');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_user_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"avatar" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"payload" text NOT NULL,
	"iv" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"pick_no" integer NOT NULL,
	"round" integer NOT NULL,
	"draft_slot" integer,
	"team_id" uuid,
	"player_id" text,
	"picked_by_platform_user_id" text,
	"is_keeper" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"platform_draft_id" text NOT NULL,
	"season" text NOT NULL,
	"type" text,
	"status" text,
	"rounds" integer,
	"start_time" timestamp with time zone,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"platform_user_id" text NOT NULL,
	"display_name" text,
	"team_name" text,
	"avatar" text,
	"is_me" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_league_id" text NOT NULL,
	"account_id" uuid,
	"season" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"status" text,
	"total_rosters" integer,
	"roster_positions" text[],
	"scoring_settings" jsonb,
	"settings" jsonb,
	"previous_platform_league_id" text,
	"platform_draft_id" text,
	"raw" jsonb,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchup_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matchup_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"points" real,
	"is_starter" boolean DEFAULT false NOT NULL,
	"slot_index" integer
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"platform_matchup_id" text,
	"team_id" uuid NOT NULL,
	"opponent_team_id" uuid,
	"points" numeric(10, 2),
	"projected_points" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_state" (
	"id" text PRIMARY KEY DEFAULT 'nfl' NOT NULL,
	"season" text NOT NULL,
	"season_type" text NOT NULL,
	"week" integer NOT NULL,
	"display_week" integer NOT NULL,
	"league_season" text,
	"previous_season" text,
	"season_start_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season" text NOT NULL,
	"abbr" text NOT NULL,
	"name" text,
	"bye_week" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_aliases" (
	"platform" "platform" NOT NULL,
	"platform_player_id" text NOT NULL,
	"player_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_aliases_platform_platform_player_id_pk" PRIMARY KEY("platform","platform_player_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"sleeper_id" text,
	"espn_id" text,
	"yahoo_id" text,
	"gsis_id" text,
	"sportradar_id" text,
	"full_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"search_name" text,
	"position" text,
	"fantasy_positions" text[],
	"nfl_team" text,
	"number" integer,
	"age" integer,
	"years_exp" integer,
	"college" text,
	"height" text,
	"weight" text,
	"status" text,
	"injury_status" text,
	"injury_body_part" text,
	"injury_notes" text,
	"practice_participation" text,
	"depth_chart_position" text,
	"depth_chart_order" integer,
	"search_rank" integer,
	"active" boolean DEFAULT true,
	"news_updated" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"kind" "roster_slot_kind" NOT NULL,
	"slot_position" text,
	"slot_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform",
	"scope" text NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"platform_team_id" text NOT NULL,
	"member_id" uuid,
	"name" text,
	"avatar" text,
	"is_mine" boolean DEFAULT false NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL,
	"points_for" numeric(10, 2) DEFAULT '0' NOT NULL,
	"points_against" numeric(10, 2) DEFAULT '0' NOT NULL,
	"potential_points" numeric(10, 2),
	"waiver_position" integer,
	"waiver_budget_used" integer,
	"division" integer,
	"streak" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trending_players" (
	"platform" "platform" NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	"lookback_hours" integer DEFAULT 24 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trending_players_platform_player_id_kind_pk" PRIMARY KEY("platform","player_id","kind")
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchup_players" ADD CONSTRAINT "matchup_players_matchup_id_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchup_players" ADD CONSTRAINT "matchup_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_opponent_team_id_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_slots" ADD CONSTRAINT "roster_slots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trending_players" ADD CONSTRAINT "trending_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_platform_user_uq" ON "accounts" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_account_kind_uq" ON "credentials" USING btree ("account_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_draft_pick_uq" ON "draft_picks" USING btree ("draft_id","pick_no");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_platform_draft_uq" ON "drafts" USING btree ("platform_draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_members_league_user_uq" ON "league_members" USING btree ("league_id","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_platform_league_season_uq" ON "leagues" USING btree ("platform","platform_league_id","season");--> statement-breakpoint
CREATE INDEX "leagues_season_idx" ON "leagues" USING btree ("season");--> statement-breakpoint
CREATE UNIQUE INDEX "matchup_players_matchup_player_uq" ON "matchup_players" USING btree ("matchup_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matchups_league_week_team_uq" ON "matchups" USING btree ("league_id","week","team_id");--> statement-breakpoint
CREATE INDEX "matchups_week_idx" ON "matchups" USING btree ("season","week");--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_teams_season_abbr_uq" ON "nfl_teams" USING btree ("season","abbr");--> statement-breakpoint
CREATE INDEX "player_aliases_player_idx" ON "player_aliases" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "players_search_name_idx" ON "players" USING btree ("search_name");--> statement-breakpoint
CREATE INDEX "players_position_idx" ON "players" USING btree ("position");--> statement-breakpoint
CREATE INDEX "players_nfl_team_idx" ON "players" USING btree ("nfl_team");--> statement-breakpoint
CREATE INDEX "players_espn_id_idx" ON "players" USING btree ("espn_id");--> statement-breakpoint
CREATE INDEX "players_yahoo_id_idx" ON "players" USING btree ("yahoo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_slots_team_player_uq" ON "roster_slots" USING btree ("team_id","player_id");--> statement-breakpoint
CREATE INDEX "roster_slots_player_idx" ON "roster_slots" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_league_platform_team_uq" ON "teams" USING btree ("league_id","platform_team_id");--> statement-breakpoint
CREATE INDEX "teams_is_mine_idx" ON "teams" USING btree ("is_mine");