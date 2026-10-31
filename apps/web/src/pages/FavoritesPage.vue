<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue';
import { api, ApiError, type Listing } from '../api';
import ListingCard from '../components/ListingCard.vue';
import { favorites } from '../favorites';

const items = ref<Listing[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

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
    <h1 class="page-title">收藏</h1>
    <p v-if="error" class="state error" role="alert">{{ error }}</p>
    <p v-else-if="loading && items.length === 0" class="state" role="status">加载中…</p>
    <p v-else-if="favorites.length === 0" class="state">还没有收藏。在商品页点「♡ 收藏」，降价时回来这里看。</p>
    <ul v-else class="list">
      <li v-for="listing in items" :key="listing.id"><ListingCard :listing="listing" /></li>
    </ul>
    <p class="hint">收藏只保存在这台设备的浏览器里。</p>
  </main>
</template>

<style scoped>
.hint { font-size: 12px; color: var(--muted); text-align: center; margin-top: 16px; }
</style>
