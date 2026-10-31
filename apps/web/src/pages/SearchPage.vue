<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api, type Platform } from '../api';
import ListingFeed from '../components/ListingFeed.vue';
import { usePagedList } from '../usePagedList';

const input = ref('');
const filters = reactive({ q: '', platform: 'all' as Platform | 'all', onSale: false });

const feed = usePagedList((page) => api.listings({
  ...(filters.q ? { q: filters.q } : {}),
  ...(filters.platform === 'all' ? {} : { platform: filters.platform }),
  ...(filters.onSale ? { onSale: true } : {}),
  type: 'game',
  page
}));

let timer: ReturnType<typeof setTimeout> | undefined;
watch(input, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => { filters.q = value.trim().slice(0, 100); }, 300);
});
watch(filters, () => feed.reset(), { immediate: true });
</script>

<template>
  <main class="page">
    <h1 class="page-title">搜索</h1>
    <input v-model="input" type="search" class="search" placeholder="游戏名，例如 マリオ、ゼルダ" aria-label="搜索游戏" enterkeyhint="search" />
    <div class="controls">
      <div class="segmented" role="group" aria-label="平台">
        <button v-for="option in (['all', 'switch2', 'switch'] as const)" :key="option"
          :class="{ on: filters.platform === option }" :aria-pressed="filters.platform === option"
          @click="filters.platform = option">
          {{ option === 'switch2' ? 'Switch 2' : option === 'switch' ? 'Switch' : '全部' }}
        </button>
      </div>
      <label class="select check">
        <input v-model="filters.onSale" type="checkbox" /> 只看打折
      </label>
    </div>
    <p v-if="!filters.q" class="hint">按发售日排列（含未发售）</p>
    <ListingFeed
      :items="feed.items.value" :total="feed.total.value" :loading="feed.loading.value" :error="feed.error.value"
      :has-more="feed.hasMore()" :empty-text="`没有找到「${filters.q}」相关的游戏`"
      @more="feed.loadMore" @retry="feed.reset"
    />
  </main>
</template>

<style scoped>
.search {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 16px;
  margin-bottom: 10px;
}

.check { display: inline-flex; align-items: center; gap: 6px; }
.hint { font-size: 13px; color: var(--muted); margin: 0 0 8px; }
</style>
