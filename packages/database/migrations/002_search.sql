-- Filled by the next catalog sync; normalizeSearchText from @eshop-tracker/shared defines the form.
ALTER TABLE regional_listings ADD COLUMN title_norm text NOT NULL DEFAULT '';

-- Titles of the same game in other regions and languages, joined to listings by platform and the 4-character game code.
CREATE TABLE title_aliases (
  platform text NOT NULL CHECK (platform IN ('switch', 'switch2')),
  product_core text NOT NULL CHECK (product_core ~ '^[A-Z0-9]{4}$'),
  language text NOT NULL CHECK (language IN ('en', 'zh')),
  title text NOT NULL,
  title_norm text NOT NULL,
  PRIMARY KEY (platform, product_core, language, title)
);

CREATE INDEX regional_listings_product_core_idx ON regional_listings (platform, left(product_code, 4));
