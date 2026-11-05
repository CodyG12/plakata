CREATE TABLE "question_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"prompt" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"plakata_pick" text,
	"top_five_override" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validation" jsonb,
	"validated_hash" text,
	"published_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stat_rankings" (
	"question_version_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"value" integer NOT NULL,
	"rank" integer NOT NULL,
	"bunt_override" boolean NOT NULL,
	"data_release" text NOT NULL,
	CONSTRAINT "stat_rankings_question_version_id_player_id_pk" PRIMARY KEY("question_version_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "question_versions" ADD COLUMN "top_five_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "question_versions" ADD COLUMN "validation" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "source" text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "override_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "question_drafts" ADD CONSTRAINT "question_drafts_published_version_id_question_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_rankings" ADD CONSTRAINT "stat_rankings_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_rankings" ADD CONSTRAINT "stat_rankings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_drafts_slug" ON "question_drafts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "stat_rankings_rank" ON "stat_rankings" USING btree ("question_version_id","rank");