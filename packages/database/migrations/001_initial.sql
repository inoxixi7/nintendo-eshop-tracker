CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regional_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id),
  country text NOT NULL CHECK (country IN ('JP', 'US', 'GB')),
  source text NOT NULL,
  source_id text NOT NULL,
  product_code text,
  title text NOT NULL,
  publisher text,
  developer text,
  description text,
  image_url text,
  release_date date,
  product_type text NOT NULL,
  source_url text,
  source_payload jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, source, source_id)
);

CREATE TABLE current_prices (
  regional_listing_id uuid PRIMARY KEY REFERENCES regional_listings(id) ON DELETE CASCADE,
  currency text NOT NULL,
  regular_amount_minor integer NOT NULL CHECK (regular_amount_minor >= 0),
  discount_amount_minor integer CHECK (discount_amount_minor >= 0),
  discount_start_at timestamptz,
  discount_end_at timestamptz,
  sales_status text NOT NULL,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  regional_listing_id uuid NOT NULL REFERENCES regional_listings(id) ON DELETE CASCADE,
  currency text NOT NULL,
  regular_amount_minor integer NOT NULL CHECK (regular_amount_minor >= 0),
  discount_amount_minor integer CHECK (discount_amount_minor >= 0),
  discount_start_at timestamptz,
  discount_end_at timestamptz,
  sales_status text NOT NULL,
  observed_at timestamptz NOT NULL
);

CREATE TABLE sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('catalog', 'prices')),
  country text NOT NULL CHECK (country IN ('JP', 'US', 'GB')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  items_read integer NOT NULL DEFAULT 0,
  items_written integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text
);

CREATE INDEX regional_listings_active_source_idx
  ON regional_listings (country, source, is_active, source_id);
CREATE INDEX price_history_listing_observed_idx
  ON price_history (regional_listing_id, observed_at);
CREATE INDEX sync_runs_country_job_started_idx
  ON sync_runs (country, job_type, started_at DESC);
