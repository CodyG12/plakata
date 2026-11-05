CREATE TABLE "daily_challenges" (
	"day" date PRIMARY KEY NOT NULL,
	"question_version_ids" integer[] NOT NULL,
	"snapshot_ids" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"daily_day" date,
	"status" text DEFAULT 'active' NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"last_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"attributes" jsonb NOT NULL,
	"data_release" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_eligibility" (
	"question_version_id" integer NOT NULL,
	"player_id" text NOT NULL,
	CONSTRAINT "question_eligibility_question_version_id_player_id_pk" PRIMARY KEY("question_version_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"prompt" text NOT NULL,
	"category" text NOT NULL,
	"criteria_type" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"data_release" text NOT NULL,
	"eligible_count" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"slug" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rarity_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"question_version_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"participant_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"ip_hash" text,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rarity_stats" (
	"question_version_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"eligible_count" integer NOT NULL,
	"total_responses" integer NOT NULL,
	"prior_probability" double precision NOT NULL,
	"observed_probability" double precision NOT NULL,
	"smoothed_probability" double precision NOT NULL,
	"calibrated_rarity" double precision NOT NULL,
	"snapshot_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rarity_stats_question_version_id_player_id_pk" PRIMARY KEY("question_version_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"question_version_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"opens_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"token_id" text,
	"accepted_player_id" text,
	"accepted_text" text,
	"explanation" text,
	"tier" text,
	"points" integer,
	"rarity" double precision,
	"score_method" text,
	"estimate_note" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "rounds_points_fixed" CHECK ("rounds"."points" IS NULL OR "rounds"."points" IN (0, 10, 25, 50, 75, 100))
);
--> statement-breakpoint
CREATE TABLE "scoring_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_version_id" integer NOT NULL,
	"calc_version" text NOT NULL,
	"alpha" double precision NOT NULL,
	"plakata_pick" text NOT NULL,
	"total_observations" integer NOT NULL,
	"distribution" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"question_version_id" integer NOT NULL,
	"participant_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"chosen_player_id" text,
	"resolved_player_id" text,
	"outcome" text NOT NULL,
	"accepted" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_daily_day_daily_challenges_day_fk" FOREIGN KEY ("daily_day") REFERENCES "public"."daily_challenges"("day") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_eligibility" ADD CONSTRAINT "question_eligibility_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_eligibility" ADD CONSTRAINT "question_eligibility_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_slug_questions_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."questions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_observations" ADD CONSTRAINT "rarity_observations_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_observations" ADD CONSTRAINT "rarity_observations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_observations" ADD CONSTRAINT "rarity_observations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_observations" ADD CONSTRAINT "rarity_observations_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_stats" ADD CONSTRAINT "rarity_stats_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_stats" ADD CONSTRAINT "rarity_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rarity_stats" ADD CONSTRAINT "rarity_stats_snapshot_id_scoring_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."scoring_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_snapshot_id_scoring_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."scoring_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_accepted_player_id_players_id_fk" FOREIGN KEY ("accepted_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_snapshots" ADD CONSTRAINT "scoring_snapshots_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_snapshots" ADD CONSTRAINT "scoring_snapshots_plakata_pick_players_id_fk" FOREIGN KEY ("plakata_pick") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_resolved_player_id_players_id_fk" FOREIGN KEY ("resolved_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_participant" ON "games" USING btree ("participant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "question_versions_slug_version" ON "question_versions" USING btree ("slug","version");--> statement-breakpoint
CREATE UNIQUE INDEX "question_versions_one_active" ON "question_versions" USING btree ("slug") WHERE "question_versions"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "rarity_observations_one_per_participant" ON "rarity_observations" USING btree ("participant_id","question_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rarity_observations_round" ON "rarity_observations" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "rarity_observations_question" ON "rarity_observations" USING btree ("question_version_id","player_id");--> statement-breakpoint
CREATE INDEX "rarity_observations_ip" ON "rarity_observations" USING btree ("ip_hash","question_version_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_game_position" ON "rounds" USING btree ("game_id","position");--> statement-breakpoint
CREATE INDEX "scoring_snapshots_active" ON "scoring_snapshots" USING btree ("question_version_id","activated_at");--> statement-breakpoint
CREATE INDEX "submissions_round" ON "submissions" USING btree ("round_id");