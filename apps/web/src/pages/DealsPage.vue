<script setup lang="ts">
import { reactive, watch } from 'vue';
import { api, type Platform } from '../api';
import ListingFeed from '../components/ListingFeed.vue';
import { usePagedList } from '../usePagedList';

const filters = reactive({
  platform: 'switch2' as Platform | 'all',
  gamesOnly: true,
  sort: 'discount' as 'discount' | 'endingSoon',
  minDiscountPercent: 0
});

const feed = usePagedList((page) => api.deals({
  ...(filters.platform === 'all' ? {} : { platform: filters.platform }),
  ...(filters.gamesOnly ? { type: 'game' as const } : {}),
  ...(filters.minDiscountPercent > 0 ? { minDiscountPercent: filters.minDiscountPercent } : {}),
  sort: filters.sort,
  page
}));

watch(filters, () => feed.reset(), { immediate: true });
</script>

<template>
  <main class="page">
    <h1 class="page-title">折扣</h1>
    <div class="controls">
      <div class="segmented" role="group" aria-label="平台">
        <button v-for="option in (['switch2', 'switch', 'all'] as const)" :key="option"
          :class="{ on: filters.platform === option }" :aria-pressed="filters.platform === option"
          @click="filters.platform = option">
          {{ option === 'switch2' ? 'Switch 2' : option === 'switch' ? 'Switch' : '全部' }}
        </button>
      </div>
      <div class="segmented" role="group" aria-label="排序">
        <button :class="{ on: filters.sort === 'discount' }" :aria-pressed="filters.sort === 'discount'" @click="filters.sort = 'discount'">折扣最大</button>
        <button :class="{ on: filters.sort === 'endingSoon' }" :aria-pressed="filters.sort === 'endingSoon'" @click="filters.sort = 'endingSoon'">快结束</button>
      </div>
      <select v-model.number="filters.minDiscountPercent" class="select" aria-label="最低折扣">
        <option :value="0">任意折扣</option>
        <option :value="30">30% 以上</option>
        <option :value="50">50% 以上</option>
        <option :value="70">70% 以上</option>
      </select>
      <label class="select check">
        <input v-model="filters.gamesOnly" type="checkbox" /> 只看游戏
      </label>
    </div>
    <ListingFeed
      :items="feed.items.value" :total="feed.total.value" :loading="feed.loading.value" :error="feed.error.value"
      :has-more="feed.hasMore()" empty-text="当前没有符合条件的折扣"
      @more="feed.loadMore" @retry="feed.reset"
    />
  </main>
</template>

<style scoped>
.check { display: inline-flex; align-items: center; gap: 6px; }
</style>
