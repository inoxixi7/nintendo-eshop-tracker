import type { QueryClient } from '@eshop-tracker/database';

export type Platform = 'switch' | 'switch2';
export type ProductType = 'game' | 'bundle' | 'dlc' | 'unknown';

export interface ListingFilters {
  readonly q?: string | undefined;
  readonly platform?: Platform | undefined;
  readonly type?: ProductType | undefined;
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
  const where = ["l.country = 'JP'", 'l.is_active = TRUE'];
  const bind = (value: unknown) => `$${values.push(value)}`;

  if (filters.q !== undefined) where.push(`l.title ILIKE ${bind(`%${escapeLike(filters.q)}%`)}`);
  if (filters.platform !== undefined) where.push(`l.platform = ${bind(filters.platform)}`);
  if (filters.type !== undefined) where.push(`l.product_type = ${bind(filters.type)}`);
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

export async function getListing(db: QueryClient, id: string, now = new Date()): Promise<ListingDetailDto | null> {
  const result = await db.query(
    `SELECT ${LISTING_COLUMNS}, l.product_code, l.description, l.last_seen_at
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
  const result = await db.query<{ job_type: string; finished_at: Date | string }>(
    `SELECT job_type, max(finished_at) AS finished_at
     FROM sync_runs
     WHERE country = 'JP' AND status IN ('success', 'partial')
     GROUP BY job_type`
  );
  const lastSuccess = Object.fromEntries(result.rows.map((row) => [row.job_type, iso(row.finished_at)]));
  const pricesAt = lastSuccess.prices ?? null;

  return {
    status: 'ok' as const,
    database: 'ok' as const,
    lastSuccessfulSync: { JP: { catalog: lastSuccess.catalog ?? null, prices: pricesAt } },
    stale: pricesAt === null || now.getTime() - new Date(pricesAt).getTime() > STALE_AFTER_MS
  };
}
