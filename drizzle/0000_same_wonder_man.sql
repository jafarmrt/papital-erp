CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"date" text NOT NULL,
	"features" text NOT NULL,
	"fixes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '',
	"city" text DEFAULT '',
	"address" text DEFAULT '',
	"notes" text DEFAULT '',
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" double precision NOT NULL,
	"unit_price" double precision DEFAULT 0,
	"discount" double precision DEFAULT 0,
	"location" text DEFAULT 'safe'
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"ref_number" text NOT NULL,
	"date" text NOT NULL,
	"user" text,
	"notes" text,
	"buyer_name" text DEFAULT '',
	"buyer_city" text DEFAULT '',
	"buyer_phone" text DEFAULT '',
	"buyer_address" text DEFAULT '',
	"status" text DEFAULT 'final',
	"is_deleted" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "item_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"title" text NOT NULL,
	"price" double precision NOT NULL,
	"currency" text DEFAULT 'IRR',
	"is_deleted" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"current_stock" double precision DEFAULT 0,
	"unit" text NOT NULL,
	"category" text DEFAULT '',
	"image" text DEFAULT '',
	"thumbnail" text DEFAULT '',
	"reorder_point" double precision DEFAULT 0,
	"weighted_average_cost" double precision DEFAULT 0,
	"stocks" jsonb DEFAULT '{}'::jsonb,
	"is_deleted" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"type" text NOT NULL,
	"quantity" double precision NOT NULL,
	"date" text NOT NULL,
	"document_type" text,
	"document_ref" text,
	"user" text,
	"notes" text,
	"location" text DEFAULT 'safe',
	"is_deleted" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_active" integer DEFAULT 1,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
