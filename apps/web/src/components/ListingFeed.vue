<script setup lang="ts">
import type { Listing } from '../api';
import { t } from '../i18n';
import GameTile from './GameTile.vue';
import ListingCard from './ListingCard.vue';

withDefaults(defineProps<{
  items: Listing[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  emptyText: string;
  layout?: 'grid' | 'list';
}>(), { layout: 'list' });
defineEmits<{ more: []; retry: [] }>();
</script>

<template>
  <p v-if="items.length > 0" class="count">{{ t('feed.total', { n: total.toLocaleString() }) }}</p>
  <ul :class="layout">
    <li v-for="listing in items" :key="listing.id">
      <GameTile v-if="layout === 'grid'" :listing="listing" />
      <ListingCard v-else :listing="listing" />
    </li>
    <template v-if="loading && items.length === 0">
      <li v-for="n in 6" :key="`s${n}`" aria-hidden="true" class="ghost" :class="layout">
        <div class="skeleton" />
      </li>
    </template>
  </ul>
  <div v-if="error" class="state error" role="alert">
    {{ error }}
    <button class="more" @click="$emit('retry')">{{ t('feed.retry') }}</button>
  </div>
  <p v-else-if="loading" class="state" :class="{ 'sr-only': items.length === 0 }" role="status">{{ t('feed.loading') }}</p>
  <p v-else-if="items.length === 0" class="state">{{ emptyText }}</p>
  <button v-else-if="hasMore" class="more" @click="$emit('more')">{{ t('feed.more') }}</button>
</template>

<style scoped>
.count { font-size: 13px; color: var(--muted); margin: 0 0 10px; }
.ghost.grid .skeleton { aspect-ratio: 1; border-radius: var(--radius); }
.ghost.list .skeleton { height: 108px; border-radius: var(--radius); }
</style>
