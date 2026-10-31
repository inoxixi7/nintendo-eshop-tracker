export type Platform = 'switch' | 'switch2';
export type ProductType = 'game' | 'bundle' | 'dlc' | 'unknown';

export interface Price {
  currency: string;
  regularAmountMinor: number;
  discountAmountMinor: number | null;
  discountPercent: number | null;
  discountStartAt: string | null;
  discountEndAt: string | null;
  salesStatus: string;
  observedAt: string;
  stale: boolean;
}

export interface Listing {
  id: string;
  country: string;
  platform: Platform;
  productType: ProductType;
  title: string;
  publisher: string | null;
  imageUrl: string | null;
  releaseDate: string | null;
  sourceUrl: string | null;
  isActive: boolean;
  price: Price | null;
}

export interface ListingDetail extends Listing {
  productCode: string | null;
  description: string | null;
  lastSeenAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PricePoint {
  regularAmountMinor: number;
  discountAmountMinor: number | null;
  salesStatus: string;
  observedAt: string;
}

export interface PriceHistory {
  currency: string | null;
  points: PricePoint[];
  lowestAmountMinor: number | null;
}

export interface Health {
  lastSuccessfulSync: { JP: { catalog: string | null; prices: string | null } };
  stale: boolean;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

async function get<T>(path: string, query: Query = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.size > 0 ? `?${params}` : '';
  let response: Response;
  try {
    response = await fetch(`/v1${path}${search}`);
  } catch {
    throw new ApiError(0, '无法连接服务器，请检查网络或 Tailscale');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(429, '请求太频繁了，请稍等一分钟再试');
    throw new ApiError(response.status, body?.error?.message ?? `请求失败（${response.status}）`);
  }
  return body as T;
}

export const api = {
  deals: (query: { platform?: Platform; type?: ProductType; minDiscountPercent?: number; sort?: 'discount' | 'endingSoon'; page?: number }) =>
    get<Page<Listing>>('/deals', { pageSize: 30, ...query }),
  listings: (query: { q?: string; platform?: Platform; type?: ProductType; onSale?: boolean; sort?: 'releaseDate' | 'title' | 'discount'; page?: number }) =>
    get<Page<Listing>>('/listings', { pageSize: 30, ...query }),
  listing: (id: string) => get<ListingDetail>(`/listings/${encodeURIComponent(id)}`),
  history: (id: string) => get<PriceHistory>(`/listings/${encodeURIComponent(id)}/price-history`),
  health: () => get<Health>('/health')
};
