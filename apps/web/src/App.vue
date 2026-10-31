<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Health } from './api';
import { formatTokyo } from './format';
import { t } from './i18n';

const health = ref<Health | null>(null);

onMounted(async () => {
  health.value = await api.health().catch(() => null);
});
</script>

<template>
  <div v-if="health?.stale" class="page" style="padding-bottom: 0; min-height: 0">
    <p class="stale" role="status">
      {{ t('stale.banner', { time: health.lastSuccessfulSync.JP.prices ? formatTokyo(health.lastSuccessfulSync.JP.prices) : t('stale.never') }) }}
    </p>
  </div>
  <RouterView v-slot="{ Component }">
    <!-- keep list pages alive so returning from a detail page restores filters and scroll -->
    <KeepAlive include="DealsPage,SearchPage">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
  <!-- the detail page has its own purchase bar in this spot -->
  <nav v-if="!$route.path.startsWith('/listing/')" class="tabs" :aria-label="t('nav.main')">
    <RouterLink to="/" class="tab" exact-active-class="on">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
      <span>{{ t('nav.deals') }}</span>
    </RouterLink>
    <RouterLink to="/search" class="tab" active-class="on">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span>{{ t('nav.search') }}</span>
    </RouterLink>
    <RouterLink to="/favorites" class="tab" active-class="on">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      <span>{{ t('nav.favorites') }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  position: fixed;
  inset: auto 0 calc(12px + env(safe-area-inset-bottom));
  width: fit-content;
  margin: 0 auto;
  display: flex;
  gap: 4px;
  padding: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  backdrop-filter: saturate(1.6) blur(16px);
  -webkit-backdrop-filter: saturate(1.6) blur(16px);
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.16), 0 0 0 1px var(--line);
  z-index: 10;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--muted);
  transition: background 150ms ease, color 150ms ease;
}

.tab svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.tab.on { background: var(--accent); color: var(--accent-ink); }
</style>
