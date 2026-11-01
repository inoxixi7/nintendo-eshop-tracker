-- Games that still lack a Chinese or English name, Nintendo's own first, then by Nintendo's search score,
-- as rows to append to packages/eshop/title-aliases.tsv. Names Nintendo already publishes are filled in;
-- empty cells need one. Games that already have hand-kept names are left out.
-- Run on G3: docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' < deploy/missing-aliases.sql
WITH games AS (
  SELECT DISTINCT ON (l.title)
    l.title, l.platform, left(l.product_code, 4) AS core,
    l.source_payload->>'maker' IN ('任天堂', '株式会社ポケモン') AS first_party,
    coalesce((l.source_payload->>'score')::numeric, 0) AS score
  FROM regional_listings l
  WHERE l.product_type = 'game' AND l.is_active
    -- the worker appends hand-kept names to title_norm after a newline
    AND position(E'\n' IN l.title_norm) = 0
  ORDER BY l.title, coalesce((l.source_payload->>'score')::numeric, 0) DESC
), named AS (
  SELECT g.*,
    (SELECT string_agg(DISTINCT a.title, '|') FROM title_aliases a
      WHERE a.platform = g.platform AND a.product_core = g.core AND a.language = 'zh') AS zh,
    (SELECT string_agg(DISTINCT a.title, '|') FROM title_aliases a
      WHERE a.platform = g.platform AND a.product_core = g.core AND a.language = 'en') AS en
  FROM games g
)
SELECT concat_ws(E'\t', replace(title, E'\t', ' '), coalesce(zh, ''), coalesce(en, ''))
FROM named
WHERE zh IS NULL OR en IS NULL
ORDER BY first_party DESC, score DESC
LIMIT 300;
