import type { QueryClient } from '@eshop-tracker/database';
import { searchTokens } from '@eshop-tracker/shared';

export type Platform = 'switch' | 'switch2';

/** Stores the worker syncs. */
export const COUNTRIES = ['JP', 'US', 'GB', 'CA', 'MX', 'BR'] as const;
export type Country = (typeof COUNTRIES)[number];
export type ProductType = 'game' | 'bundle' | 'dlc' | 'unknown';

/** Nintendo Japan's own genre names, as its catalog sends them. */
export const GENRES = [
  'アクション', 'アドベンチャー', 'アーケード', 'パズル', 'シミュレーション', 'ロールプレイング', 'ストラテジー',
  'シューティング', 'パーティー', 'テーブル', 'レース', 'スポーツ', '格闘', '音楽', 'コミュニケーション',
  '学習', 'トレーニング', '実用', 'その他'
] as const;
export type Genre = (typeof GENRES)[number];

export interface ListingFilters {
  readonly country: Country;
  readonly q?: string | undefined;
  readonly platform?: Platform | undefined;
  readonly type?: ProductType | undefined;
  readonly genre?: Genre | undefined;
  readonly onSale?: boolean | undefined;
  readonly minDiscountPercent?: number | undefined;
  readonly sort: 'releaseDate' | 'title' | 'discount' | 'endingSoon';
  readonly page: number;
  readonly pageSize: number;
}

export interface PriceDto {
  readonly currency: string;
  readonly regularAmountMinor: number;
  readonly discountAmountMinor: number | null;
  readonly discountPercent: number | null;
  readonly discountStartAt: string | null;
  readonly discountEndAt: string | null;
  readonly salesStatus: string;
  readonly observedAt: string;
  readonly stale: boolean;
}

export interface ListingDto {
  readonly id: string;
  readonly country: string;
  readonly platform: Platform;
  readonly productType: ProductType;
  readonly title: string;
  readonly publisher: string | null;
  readonly imageUrl: string | null;
  readonly releaseDate: string | null;
  readonly sourceUrl: string | null;
  readonly isActive: boolean;
  readonly price: PriceDto | null;
}

export interface ListingDetailDto extends ListingDto {
  readonly productCode: string | null;
  readonly description: string | null;
  readonly genres: string[];
  /** Wide key art first, then screenshots. */
  readonly images: string[];
  readonly lastSeenAt: string;
}

export interface PricePointDto {
  readonly regularAmountMinor: number;
  readonly discountAmountMinor: number | null;
  readonly salesStatus: string;
  readonly observedAt: string;
}

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

// A discount counts only inside its window; Nintendo also returns scheduled ones.
const ACTIVE_DISCOUNT = `p.discount_amount_minor IS NOT NULL
  AND (p.discount_start_at IS NULL OR p.discount_start_at <= now())
  AND (p.discount_end_at IS NULL OR p.discount_end_at > now())`;

const DISCOUNT_PERCENT = `CASE WHEN ${ACTIVE_DISCOUNT} AND p.regular_amount_minor > 0
  THEN round((p.regular_amount_minor - p.discount_amount_minor) * 100.0 / p.regular_amount_minor)::int END`;

const LISTING_COLUMNS = `l.id, l.country, l.platform, l.product_type, l.title, l.publisher, l.image_url,
  to_char(l.release_date, 'YYYY-MM-DD') AS release_date, l.source_url, l.is_active,
  p.currency, p.regular_amount_minor, p.discount_amount_minor, p.discount_start_at, p.discount_end_at,
  p.sales_status, p.observed_at, ${DISCOUNT_PERCENT} AS discount_percent`;

const SORTS: Record<ListingFilters['sort'], string> = {
  releaseDate: 'l.release_date DESC NULLS LAST, l.id',
  title: 'l.title, l.id',
  discount: 'discount_percent DESC NULLS LAST, l.id',
  endingSoon: 'p.discount_end_at ASC NULLS LAST, l.id'
};

type Row = Record<string, unknown>;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function priceFrom(row: Row, now: Date): PriceDto | null {
  if (row.currency === null || row.currency === undefined) return null;
  const observedAt = iso(row.observed_at) ?? '';
  const discountPercent = row.discount_percent === null ? null : Number(row.discount_percent);
  return {
    currency: String(row.currency),
    regularAmountMinor: Number(row.regular_amount_minor),
    // Expose only an active discount so clients never show a scheduled one as current.
    discountAmountMinor: discountPercent === null ? null : Number(row.discount_amount_minor),
    discountPercent,
    discountStartAt: iso(row.discount_start_at),
    discountEndAt: iso(row.discount_end_at),
    salesStatus: String(row.sales_status),
    observedAt,
    stale: now.getTime() - new Date(observedAt).getTime() > STALE_AFTER_MS
  };
}

function listingFrom(row: Row, now: Date): ListingDto {
  return {
    id: String(row.id),
    country: String(row.country),
    platform: row.platform as Platform,
    productType: row.product_type as ProductType,
    title: String(row.title),
    publisher: text(row.publisher),
    imageUrl: text(row.image_url),
    releaseDate: text(row.release_date),
    sourceUrl: text(row.source_url),
    isActive: row.is_active === true,
    price: priceFrom(row, now)
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function listListings(
  db: QueryClient,
  filters: ListingFilters,
  now = new Date()
): Promise<{ items: ListingDto[]; total: number }> {
  const values: unknown[] = [];
  const bind = (value: unknown) => `$${values.push(value)}`;
  const where = [`l.country = ${bind(filters.country)}`, 'l.is_active = TRUE'];

  if (filters.q !== undefined) {
    const tokens = searchTokens(filters.q);
    if (tokens.length === 0) where.push('FALSE');
    // Each word must hit the listing's own title or a same-game title in another language. JP and GB listings
    // join aliases and JP titles (with their hand-kept names) by game code; US listings have none, so they join
    // through the game's English name, found from a Chinese alias, from a JP listing's code, or among a JP
    // listing's hand-kept names (one per line).
    for (const token of tokens) {
      const pattern = bind(`%${escapeLike(token)}%`);
      where.push(`(l.title_norm LIKE ${pattern}
        OR (l.platform, left(l.product_code, 4)) IN (SELECT platform, product_core FROM title_aliases WHERE title_norm LIKE ${pattern})
        OR (l.country <> 'JP' AND (l.platform, left(l.product_code, 4)) IN (
          SELECT jp.platform, left(jp.product_code, 4) FROM regional_listings jp WHERE jp.country = 'JP' AND jp.title_norm LIKE ${pattern}))
        OR (l.product_code IS NULL AND (l.platform, l.title_norm) IN (
          SELECT en.platform, en.title_norm FROM title_aliases hit
          JOIN title_aliases en ON en.platform = hit.platform AND en.product_core = hit.product_core AND en.language = 'en'
          WHERE hit.title_norm LIKE ${pattern}
          UNION SELECT en.platform, en.title_norm FROM regional_listings jp
          JOIN title_aliases en ON en.platform = jp.platform AND en.product_core = left(jp.product_code, 4) AND en.language = 'en'
          WHERE jp.country = 'JP' AND jp.title_norm LIKE ${pattern}
          UNION SELECT jp.platform, unnest(string_to_array(jp.title_norm, E'\\n')) FROM regional_listings jp
          WHERE jp.country = 'JP' AND jp.title_norm LIKE ${pattern})))`);
    }
  }
  if (filters.platform !== undefined) where.push(`l.platform = ${bind(filters.platform)}`);
  if (filters.type !== undefined) where.push(`l.product_type = ${bind(filters.type)}`);
  // shortcut: genres are read from the catalog payload (US listings carry JP names mapped at sync); move them to a column when a region needs its own genre list
  if (filters.genre !== undefined) where.push(`l.source_payload->'genre' ? ${bind(filters.genre)}`);
  if (filters.onSale === true) where.push(`(${ACTIVE_DISCOUNT})`);
  if (filters.onSale === false) where.push(`NOT COALESCE(${ACTIVE_DISCOUNT}, FALSE)`);
  if (filters.minDiscountPercent !== undefined) {
    where.push(`(${DISCOUNT_PERCENT}) >= ${bind(filters.minDiscountPercent)}`);
  }

  const from = `FROM regional_listings l LEFT JOIN current_prices p ON p.regional_listing_id = l.id
    WHERE ${where.join(' AND ')}`;
  const count = await db.query<{ total: string }>(`SELECT count(*) AS total ${from}`, values);
  const page = await db.query(
    `SELECT ${LISTING_COLUMNS} ${from} ORDER BY ${SORTS[filters.sort]}
     LIMIT ${bind(filters.pageSize)} OFFSET ${bind((filters.page - 1) * filters.pageSize)}`,
    values
  );

  return {
    items: page.rows.map((row) => listingFrom(row, now)),
    total: Number(count.rows[0]?.total ?? 0)
  };
}

// shortcut: reads each store's own payload shape (JP iurl/sslurl hashes, US productGallery, GB's one wide image); map at sync if another region arrives
function imageUrl(value: unknown): string | null {
  if (typeof value === 'object' && value !== null) {
    // US gallery entry; videos are skipped
    const { publicId, resourceType } = value as { publicId?: unknown; resourceType?: unknown };
    return resourceType === 'image' && typeof publicId === 'string' && /^[\w/.-]+$/.test(publicId)
      ? `https://assets.nintendo.com/image/upload/q_auto/f_auto/${publicId}`
      : null;
  }
  if (typeof value !== 'string') return null;
  if (/^[0-9a-f]{64}$/.test(value)) return `https://img-eshop.cdn.nintendo.net/i/${value}.jpg`;
  return value.startsWith('https://') ? value : null;
}

export async function getListing(db: QueryClient, id: string, now = new Date()): Promise<ListingDetailDto | null> {
  const result = await db.query(
    `SELECT ${LISTING_COLUMNS}, l.product_code, l.description, l.last_seen_at,
       CASE WHEN jsonb_typeof(l.source_payload->'genre') = 'array' THEN l.source_payload->'genre' END AS genres,
       COALESCE(l.source_payload->'iurl', l.source_payload->'image_url_h2x1_s') AS hero_image, COALESCE(l.source_payload->'sslurl', l.source_payload->'productGallery') AS screenshots
     FROM regional_listings l LEFT JOIN current_prices p ON p.regional_listing_id = l.id
     WHERE l.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    ...listingFrom(row, now),
    productCode: text(row.product_code),
    description: text(row.description),
    genres: Array.isArray(row.genres) ? row.genres.filter((genre): genre is string => typeof genre === 'string') : [],
    images: [row.hero_image, ...(Array.isArray(row.screenshots) ? row.screenshots : [])].flatMap((value) => imageUrl(value) ?? []),
    lastSeenAt: iso(row.last_seen_at) ?? ''
  };
}

export async function getPriceHistory(
  db: QueryClient,
  id: string,
  range: { from?: string | undefined; to?: string | undefined; limit: number }
): Promise<{ currency: string | null; points: PricePointDto[]; lowestAmountMinor: number | null } | null> {
  const listing = await db.query('SELECT 1 FROM regional_listings WHERE id = $1', [id]);
  if (listing.rows.length === 0) return null;

  const result = await db.query(
    `SELECT currency, regular_amount_minor, discount_amount_minor, sales_status, observed_at
     FROM price_history
     WHERE regional_listing_id = $1
       AND ($2::timestamptz IS NULL OR observed_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR observed_at <= $3::timestamptz)
     ORDER BY observed_at ASC
     LIMIT $4`,
    [id, range.from ?? null, range.to ?? null, range.limit]
  );
  const points = result.rows.map((row) => ({
    regularAmountMinor: Number(row.regular_amount_minor),
    discountAmountMinor: row.discount_amount_minor === null ? null : Number(row.discount_amount_minor),
    salesStatus: String(row.sales_status),
    observedAt: iso(row.observed_at) ?? ''
  }));
  const amounts = points.map((point) => point.discountAmountMinor ?? point.regularAmountMinor);

  return {
    currency: text(result.rows[0]?.currency),
    points,
    lowestAmountMinor: amounts.length === 0 ? null : Math.min(...amounts)
  };
}

export async function getHealth(db: QueryClient, now = new Date()) {
  const result = await db.query<{ country: string; job_type: string; finished_at: Date | string }>(
    `SELECT country, job_type, max(finished_at) AS finished_at
     FROM sync_runs
     WHERE status IN ('success', 'partial')
     GROUP BY country, job_type`
  );
  const lastSuccess = (country: Country, jobType: string) =>
    iso(result.rows.find((row) => row.country === country && row.job_type === jobType)?.finished_at);
  const regions = Object.fromEntries(COUNTRIES.map((country) => {
    const prices = lastSuccess(country, 'prices');
    const stale = prices === null || now.getTime() - new Date(prices).getTime() > STALE_AFTER_MS;
    return [country, { catalog: lastSuccess(country, 'catalog'), prices, stale }];
  })) as Record<Country, { catalog: string | null; prices: string | null; stale: boolean }>;

  return {
    status: 'ok' as const,
    database: 'ok' as const,
    lastSuccessfulSync: regions,
    stale: COUNTRIES.some((country) => regions[country].stale)
  };
}
