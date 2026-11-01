<script setup lang="ts">
import { reactive, watch } from 'vue';
import { api, type Platform } from '../api';
import GenreChips from '../components/GenreChips.vue';
import ListingFeed from '../components/ListingFeed.vue';
import SettingsButtons from '../components/SettingsButtons.vue';
import { t, type Genre } from '../i18n';
import { region } from '../region';
import { usePagedList } from '../usePagedList';

const filters = reactive({
  platform: 'switch2' as Platform | 'all',
  genre: null as Genre | null,
  gamesOnly: true,
  sort: 'discount' as 'discount' | 'endingSoon',
  minDiscountPercent: 0
});

const feed = usePagedList((page) => api.deals({
  ...(filters.platform === 'all' ? {} : { platform: filters.platform }),
  ...(filters.gamesOnly ? { type: 'game' as const } : {}),
  ...(filters.genre === null ? {} : { genre: filters.genre }),
  ...(filters.minDiscountPercent > 0 ? { minDiscountPercent: filters.minDiscountPercent } : {}),
  sort: filters.sort,
  page
}));

watch([filters, region], () => feed.reset(), { immediate: true });

const toggleMin = (value: number) => { filters.minDiscountPercent = filters.minDiscountPercent === value ? 0 : value; };
</script>

<template>
  <main class="page">
    <header class="page-head with-actions">
      <div>
        <h1 class="page-title">{{ t('deals.title') }}</h1>
        <p class="page-sub">{{ t('deals.sub', { store: t(`store.${region}`) }) }}</p>
      </div>
      <SettingsButtons />
    </header>
    <div class="chips" role="toolbar" :aria-label="t('filter.label')">
      <div class="segmented" role="group" :aria-label="t('filter.platform')">
        <button v-for="option in (['switch2', 'switch', 'all'] as const)" :key="option"
          :class="{ on: filters.platform === option }" :aria-pressed="filters.platform === option"
          @click="filters.platform = option">
          {{ option === 'switch2' ? 'Switch 2' : option === 'switch' ? 'Switch' : t('filter.all') }}
        </button>
      </div>
      <span class="chip-sep" />
      <button class="chip" :class="{ on: filters.sort === 'discount' }" :aria-pressed="filters.sort === 'discount'" @click="filters.sort = 'discount'">{{ t('deals.biggest') }}</button>
      <button class="chip" :class="{ on: filters.sort === 'endingSoon' }" :aria-pressed="filters.sort === 'endingSoon'" @click="filters.sort = 'endingSoon'">{{ t('deals.endingSoon') }}</button>
      <span class="chip-sep" />
      <button v-for="value in [50, 70]" :key="value" class="chip" :class="{ on: filters.minDiscountPercent === value }"
        :aria-pressed="filters.minDiscountPercent === value" @click="toggleMin(value)">
        {{ t('deals.atLeast', { n: value }) }}
      </button>
      <button class="chip" :class="{ on: !filters.gamesOnly }" :aria-pressed="!filters.gamesOnly" @click="filters.gamesOnly = !filters.gamesOnly">{{ t('deals.withDlc') }}</button>
    </div>
    <GenreChips v-model="filters.genre" />
    <ListingFeed
      layout="grid"
      :items="feed.items.value" :total="feed.total.value" :loading="feed.loading.value" :error="feed.error.value"
      :has-more="feed.hasMore()" :empty-text="t('deals.empty')"
      @more="feed.loadMore" @retry="feed.reset"
    />
  </main>
</template>
