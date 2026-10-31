<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Health } from './api';
import { formatTokyo } from './format';

const health = ref<Health | null>(null);

onMounted(async () => {
  health.value = await api.health().catch(() => null);
});
</script>

<template>
  <div v-if="health?.stale" class="page" style="padding-bottom: 0">
    <p class="stale" role="status">
      价格可能不是最新的：最近一次成功更新于
      {{ health.lastSuccessfulSync.JP.prices ? formatTokyo(health.lastSuccessfulSync.JP.prices) : '从未' }}（东京时间）
    </p>
  </div>
  <RouterView v-slot="{ Component }">
    <!-- keep list pages alive so returning from a detail page restores filters and scroll -->
    <KeepAlive include="DealsPage,SearchPage">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
  <nav class="tabs" aria-label="主导航">
    <RouterLink to="/" class="tab" exact-active-class="on">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
      <span>折扣</span>
    </RouterLink>
    <RouterLink to="/search" class="tab" active-class="on">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span>搜索</span>
    </RouterLink>
    <RouterLink to="/favorites" class="tab" active-class="on">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      <span>收藏</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  position: fixed;
  inset: auto 0 0 0;
  display: flex;
  justify-content: space-around;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: saturate(1.6) blur(14px);
  -webkit-backdrop-filter: saturate(1.6) blur(14px);
  border-top: 1px solid var(--line);
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom));
  z-index: 10;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 72px;
  padding: 4px 0;
  font-size: 11px;
  color: var(--muted);
}

.tab svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.tab.on { color: var(--accent); font-weight: 600; }
</style>
