import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ApiError, type Listing, type Page } from '../src/api';
import ListingFeed from '../src/components/ListingFeed.vue';
import { endsIn, formatTokyo, formatYen } from '../src/format';
import { usePagedList } from '../src/usePagedList';

const listing: Listing = {
  id: '11111111-2222-4333-8444-555555555555',
  country: 'JP',
  platform: 'switch2',
  productType: 'game',
  title: 'Sword of the Sea',
  publisher: null,
  imageUrl: null,
  releaseDate: null,
  sourceUrl: null,
  isActive: true,
  price: {
    currency: 'JPY',
    regularAmountMinor: 4380,
    discountAmountMinor: 3480,
    discountPercent: 21,
    discountStartAt: null,
    discountEndAt: '2026-12-23T14:59:59Z',
    salesStatus: 'onsale',
    observedAt: '2026-10-31T11:54:31Z',
    stale: false
  }
};

const page = (items: Listing[], total = items.length): Page<Listing> => ({ items, total, page: 1, pageSize: 30 });

describe('format', () => {
  it('shows UTC sale ends in Tokyo time', () => {
    expect(formatTokyo('2026-10-31T14:59:59Z')).toContain('23:59');
  });

  it('formats whole yen', () => {
    expect(formatYen(3480)).toMatch(/3,480/);
  });

  it('describes remaining sale time', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    expect(endsIn('2026-10-31T14:59:59Z', now)).toBe('2 小时后结束');
    expect(endsIn('2026-11-04T12:00:00Z', now)).toBe('4 天后结束');
    expect(endsIn('2026-10-31T11:00:00Z', now)).toBe('已结束');
  });
});

describe('favorites', () => {
  beforeEach(() => {
    // Node 26 ships its own (disabled) global localStorage that shadows happy-dom's
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      clear: () => store.clear()
    });
    vi.resetModules();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('toggles and persists favorites across reloads', async () => {
    const first = await import('../src/favorites');
    first.toggleFavorite('a');
    first.toggleFavorite('b');
    first.toggleFavorite('a');

    vi.resetModules();
    const reloaded = await import('../src/favorites');
    expect(reloaded.favorites.value).toEqual(['b']);
  });

  it('ignores corrupted storage instead of crashing', async () => {
    localStorage.setItem('eshop-tracker:favorites', '{not json');
    const { favorites } = await import('../src/favorites');
    expect(favorites.value).toEqual([]);
  });
});

describe('usePagedList', () => {
  it('appends pages and reports when more exist', async () => {
    const fetchPage = vi.fn(async (n: number) => page([{ ...listing, id: String(n) }], 2));
    const feed = usePagedList(fetchPage);

    await feed.reset();
    expect(feed.hasMore()).toBe(true);
    await feed.loadMore();
    expect(feed.items.value.map((item) => item.id)).toEqual(['1', '2']);
    expect(feed.hasMore()).toBe(false);
  });

  it('shows the API error message', async () => {
    const feed = usePagedList(async () => { throw new ApiError(400, 'pageSize: too big'); });
    await feed.reset();
    expect(feed.error.value).toBe('pageSize: too big');
    expect(feed.loading.value).toBe(false);
  });

  it('drops a slow response superseded by a newer filter', async () => {
    let resolveSlow!: (value: Page<Listing>) => void;
    const calls = [
      new Promise<Page<Listing>>((resolve) => { resolveSlow = resolve; }),
      Promise.resolve(page([{ ...listing, id: 'new' }]))
    ];
    const feed = usePagedList(() => calls.shift()!);

    const slow = feed.reset();
    await feed.reset();
    resolveSlow(page([{ ...listing, id: 'old' }]));
    await slow;

    expect(feed.items.value.map((item) => item.id)).toEqual(['new']);
  });
});

describe('ListingFeed states', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  const render = (props: Partial<InstanceType<typeof ListingFeed>['$props']>) => mount(ListingFeed, {
    props: { items: [], total: 0, loading: false, error: null, hasMore: false, emptyText: '没有折扣', ...props },
    global: { plugins: [router] }
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('shows loading, empty and error states', async () => {
    expect(render({ loading: true }).text()).toContain('加载中');
    expect(render({}).text()).toContain('没有折扣');

    const failed = render({ error: '无法连接服务器' });
    expect(failed.text()).toContain('无法连接服务器');
    await failed.find('button').trigger('click');
    expect(failed.emitted('retry')).toHaveLength(1);
  });

  it('renders discounted prices and the load-more button', () => {
    const wrapper = render({ items: [listing], total: 31, hasMore: true });
    expect(wrapper.text()).toContain('共 31 件');
    expect(wrapper.text()).toContain('-21%');
    expect(wrapper.text()).toMatch(/3,480/);
    expect(wrapper.find('button.more').text()).toBe('加载更多');
  });
});
