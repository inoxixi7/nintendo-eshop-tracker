<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api, type Platform } from '../api';
import ListingFeed from '../components/ListingFeed.vue';
import { clearSearchHistory, forgetSearch, rememberSearch, searchHistory } from '../searchHistory';
import { usePagedList } from '../usePagedList';

const SUGGESTIONS = ['塞尔达', 'Mario Kart', 'ポケモン', '星之卡比', 'スプラトゥーン'];

const input = ref('');
const field = ref<HTMLInputElement | null>(null);
const filters = reactive({ q: '', platform: 'all' as Platform | 'all', onSale: false });

const feed = usePagedList((page) => api.listings({
  q: filters.q,
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
// an empty box shows history instead of listing the whole catalog
watch(filters, () => { if (filters.q) void feed.reset(); }, { immediate: true });

function search(term: string) {
  clearTimeout(timer);
  input.value = term;
  filters.q = term.trim().slice(0, 100);
  rememberSearch(term);
}

function submit() {
  search(input.value);
  field.value?.blur();
}

function clear() {
  input.value = '';
  filters.q = '';
  field.value?.focus();
}

function rememberOnOpen(event: MouseEvent) {
  if ((event.target as Element).closest('a')) rememberSearch(filters.q);
}
</script>

<template>
  <main class="page">
    <header class="page-head">
      <h1 class="page-title">搜索</h1>
    </header>
    <form class="bar" role="search" @submit.prevent="submit">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref="field" v-model="input" type="search" placeholder="中文、English、日本語都可以" aria-label="搜索游戏"
        enterkeyhint="search" autocomplete="off" />
      <button v-if="input" type="button" class="clear" aria-label="清除" @click="clear">✕</button>
    </form>

    <template v-if="filters.q">
      <div class="chips" role="toolbar" aria-label="筛选">
        <div class="segmented" role="group" aria-label="平台">
          <button v-for="option in (['all', 'switch2', 'switch'] as const)" :key="option"
            :class="{ on: filters.platform === option }" :aria-pressed="filters.platform === option"
            @click="filters.platform = option">
            {{ option === 'switch2' ? 'Switch 2' : option === 'switch' ? 'Switch' : '全部' }}
          </button>
        </div>
        <button class="chip" :class="{ on: filters.onSale }" :aria-pressed="filters.onSale" @click="filters.onSale = !filters.onSale">只看打折</button>
      </div>
      <div @click.capture="rememberOnOpen">
        <ListingFeed
          :items="feed.items.value" :total="feed.total.value" :loading="feed.loading.value" :error="feed.error.value"
          :has-more="feed.hasMore()" :empty-text="`没有找到「${filters.q}」相关的游戏`"
          @more="feed.loadMore" @retry="feed.reset"
        />
      </div>
    </template>

    <section v-else-if="searchHistory.length > 0" aria-labelledby="recent">
      <div class="section-head">
        <h2 id="recent">最近搜索</h2>
        <button class="link" @click="clearSearchHistory">清除</button>
      </div>
      <ul class="history">
        <li v-for="term in searchHistory" :key="term">
          <button class="term" @click="search(term)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>
            <span>{{ term }}</span>
          </button>
          <button class="remove" :aria-label="`删除「${term}」`" @click="forgetSearch(term)">✕</button>
        </li>
      </ul>
    </section>

    <section v-else aria-labelledby="try">
      <div class="section-head"><h2 id="try">试试搜索</h2></div>
      <div class="suggest">
        <button v-for="term in SUGGESTIONS" :key="term" class="chip" @click="search(term)">{{ term }}</button>
      </div>
      <p class="hint">同一款游戏用中文、英文或日文名都能找到，平假名和片假名也不用区分。</p>
    </section>
  </main>
</template>

<style scoped>
.bar {
  position: sticky;
  top: calc(8px + env(safe-area-inset-top));
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border-radius: 999px;
  padding: 0 8px 0 16px;
  margin-bottom: 14px;
  box-shadow: var(--shadow), 0 0 0 1px var(--line);
}

.bar:focus-within { box-shadow: var(--shadow), 0 0 0 2px var(--accent); }

.bar svg { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; }

.bar input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  padding: 14px 0;
  font-size: 16px;
  outline: none;
}

.bar input::-webkit-search-cancel-button { display: none; }

.clear {
  border: 0;
  background: var(--surface-2);
  color: var(--muted);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 12px;
  flex: none;
}

.section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 6px 0 8px; }
.section-head h2 { font-size: 17px; margin: 0; }
.link { border: 0; background: none; color: var(--accent); font-size: 14px; padding: 6px 0; }

.history {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.history li { display: flex; align-items: center; }
.history li + li { border-top: 1px solid var(--line); }

.term {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  background: none;
  padding: 14px 16px;
  font-size: 15px;
  text-align: left;
}

.term span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.term svg { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; }

.remove {
  border: 0;
  background: none;
  color: var(--muted);
  width: 44px;
  height: 44px;
  font-size: 13px;
  flex: none;
}

.suggest { display: flex; flex-wrap: wrap; gap: 8px; }
.hint { font-size: 13px; color: var(--muted); line-height: 1.6; margin: 16px 2px 0; }
</style>
