<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { api, ApiError, type Listing } from '../api';
import GameTile from '../components/GameTile.vue';
import { favorites } from '../favorites';

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
      <h1 class="page-title">收藏</h1>
      <p v-if="items.length > 0" class="page-sub">
        {{ items.length }} 款游戏<template v-if="onSaleCount > 0">，<strong class="hot">{{ onSaleCount }} 款正在打折</strong></template>
      </p>
    </header>
    <p v-if="error" class="state error" role="alert">{{ error }}</p>
    <p v-else-if="loading && items.length === 0" class="state" role="status">加载中…</p>
    <div v-else-if="favorites.length === 0" class="empty">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      <p>还没有收藏</p>
      <p class="sub">在游戏页点「收藏」，打折时回来这里看。</p>
    </div>
    <ul v-else class="grid">
      <li v-for="listing in items" :key="listing.id"><GameTile :listing="listing" /></li>
    </ul>
    <p class="hint">收藏只保存在这台设备的浏览器里。</p>
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
