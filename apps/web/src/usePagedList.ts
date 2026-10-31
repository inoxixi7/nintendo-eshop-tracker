import { ref } from 'vue';
import { ApiError, type Listing, type Page } from './api';
import { t } from './i18n';

export function usePagedList(fetchPage: (page: number) => Promise<Page<Listing>>) {
  const items = ref<Listing[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let page = 0;
  let generation = 0;

  async function load(next: number) {
    const current = ++generation;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchPage(next);
      // a newer reset() superseded this request
      if (current !== generation) return;
      items.value = next === 1 ? result.items : [...items.value, ...result.items];
      total.value = result.total;
      page = next;
    } catch (cause) {
      if (current === generation) error.value = cause instanceof ApiError ? cause.message : t('feed.failed');
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  return {
    items,
    total,
    loading,
    error,
    reset: () => load(1),
    loadMore: () => load(page + 1),
    hasMore: () => items.value.length < total.value
  };
}
