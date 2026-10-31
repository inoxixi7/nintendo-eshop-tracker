<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { api, ApiError, type Listing } from '../api';
import GameTile from '../components/GameTile.vue';
import { favorites } from '../favorites';
import { t } from '../i18n';

const items = ref<Listing[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const onSaleCount = computed(() => items.value.filter((item) => item.price?.discountPercent != null).length);

// shortcut: one request per favorite; fine for a personal list, add a batch endpoint if it grows past ~50
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const results = await Promise.all(favorites.value.map((id) => api.listing(id).catch((cause) => {
      if (cause instanceof ApiError && cause.status === 404) return null;
      throw cause;
    })));
    items.value = results.filter((item) => item !== null);
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onActivated(load);
</script>

<template>
  <main class="page">
    <header class="page-head">
      <h1 class="page-title">{{ t('favorites.title') }}</h1>
      <p v-if="items.length > 0" class="page-sub">
        {{ t('favorites.count', { n: items.length }) }}<template v-if="onSaleCount > 0"> · <strong class="hot">{{ t('favorites.onSale', { n: onSaleCount }) }}</strong></template>
      </p>
    </header>
    <p v-if="error" class="state error" role="alert">{{ error }}</p>
    <p v-else-if="loading && items.length === 0" class="state" role="status">{{ t('feed.loading') }}</p>
    <div v-else-if="favorites.length === 0" class="empty">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      <p>{{ t('favorites.none') }}</p>
      <p class="sub">{{ t('favorites.noneSub') }}</p>
    </div>
    <ul v-else class="grid">
      <li v-for="listing in items" :key="listing.id"><GameTile :listing="listing" /></li>
    </ul>
    <p class="hint">{{ t('favorites.hint') }}</p>
  </main>
</template>

<style scoped>
.hot { color: var(--sale); }
.empty { text-align: center; padding: 48px 16px 24px; }
.empty svg { width: 48px; height: 48px; fill: none; stroke: var(--line); stroke-width: 1.6; }
.empty p { margin: 8px 0 0; font-size: 16px; font-weight: 600; }
.empty .sub { font-size: 14px; font-weight: 400; color: var(--muted); }
.hint { font-size: 12px; color: var(--muted); text-align: center; margin-top: 24px; }
</style>
