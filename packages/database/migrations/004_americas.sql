-- Canada, Mexico and Brazil share the US store's catalog and title IDs
ALTER TABLE regional_listings DROP CONSTRAINT regional_listings_country_check,
  ADD CONSTRAINT regional_listings_country_check CHECK (country IN ('JP', 'US', 'GB', 'CA', 'MX', 'BR'));
ALTER TABLE sync_runs DROP CONSTRAINT sync_runs_country_check,
  ADD CONSTRAINT sync_runs_country_check CHECK (country IN ('JP', 'US', 'GB', 'CA', 'MX', 'BR'));
