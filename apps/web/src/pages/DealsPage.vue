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

const toggleMin = (value: number) => { filters.minDiscountPercent = filters.minDiscountPercent === value ? 0 : value; };
</script>

<template>
  <main class="page">
    <header class="page-head">
      <h1 class="page-title">折扣</h1>
      <p class="page-sub">日本 eShop 正在打折的游戏，每天更新</p>
    </header>
    <div class="chips" role="toolbar" aria-label="筛选">
      <div class="segmented" role="group" aria-label="平台">
        <button v-for="option in (['switch2', 'switch', 'all'] as const)" :key="option"
          :class="{ on: filters.platform === option }" :aria-pressed="filters.platform === option"
          @click="filters.platform = option">
          {{ option === 'switch2' ? 'Switch 2' : option === 'switch' ? 'Switch' : '全部' }}
        </button>
      </div>
      <span class="chip-sep" />
      <button class="chip" :class="{ on: filters.sort === 'discount' }" :aria-pressed="filters.sort === 'discount'" @click="filters.sort = 'discount'">折扣最大</button>
      <button class="chip" :class="{ on: filters.sort === 'endingSoon' }" :aria-pressed="filters.sort === 'endingSoon'" @click="filters.sort = 'endingSoon'">快结束</button>
      <span class="chip-sep" />
      <button v-for="value in [50, 70]" :key="value" class="chip" :class="{ on: filters.minDiscountPercent === value }"
        :aria-pressed="filters.minDiscountPercent === value" @click="toggleMin(value)">
        {{ value }}% 以上
      </button>
      <button class="chip" :class="{ on: !filters.gamesOnly }" :aria-pressed="!filters.gamesOnly" @click="filters.gamesOnly = !filters.gamesOnly">含 DLC</button>
    </div>
    <ListingFeed
      layout="grid"
      :items="feed.items.value" :total="feed.total.value" :loading="feed.loading.value" :error="feed.error.value"
      :has-more="feed.hasMore()" empty-text="当前没有符合条件的折扣"
      @more="feed.loadMore" @retry="feed.reset"
    />
  </main>
</template>
