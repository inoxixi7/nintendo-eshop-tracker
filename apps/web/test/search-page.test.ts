import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

const listings = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 30 }));
vi.mock('../src/api', async (original) => ({ ...(await original<typeof import('../src/api')>()), api: { listings } }));

describe('SearchPage', () => {
  beforeEach(() => {
    const store = new Map<string, string>([['eshop-tracker:search-history', JSON.stringify(['ゼルダ'])]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } });
    vi.resetModules();
    listings.mockClear();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  async function render() {
    const { default: SearchPage } = await import('../src/pages/SearchPage.vue');
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
    return mount(SearchPage, { global: { plugins: [router] } });
  }

  it('shows recent searches instead of loading the whole catalog', async () => {
    const page = await render();
    await flushPromises();

    expect(listings).not.toHaveBeenCalled();
    expect(page.text()).toContain('最近搜索');
    expect(page.text()).toContain('ゼルダ');
  });

  it('searches a history entry when tapped', async () => {
    const page = await render();
    await page.find('button.term').trigger('click');
    await flushPromises();

    expect(listings).toHaveBeenCalledWith(expect.objectContaining({ q: 'ゼルダ', type: 'game', page: 1 }));
  });
});
