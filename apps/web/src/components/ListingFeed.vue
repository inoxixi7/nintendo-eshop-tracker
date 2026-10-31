<script setup lang="ts">
import type { Listing } from '../api';
import ListingCard from './ListingCard.vue';

defineProps<{
  items: Listing[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  emptyText: string;
}>();
defineEmits<{ more: []; retry: [] }>();
</script>

<template>
  <p v-if="items.length > 0" class="count">共 {{ total.toLocaleString() }} 件</p>
  <ul class="list">
    <li v-for="listing in items" :key="listing.id"><ListingCard :listing="listing" /></li>
  </ul>
  <div v-if="error" class="state error" role="alert">
    {{ error }}
    <button class="more" @click="$emit('retry')">重试</button>
  </div>
  <p v-else-if="loading" class="state" role="status">加载中…</p>
  <p v-else-if="items.length === 0" class="state">{{ emptyText }}</p>
  <button v-else-if="hasMore" class="more" @click="$emit('more')">加载更多</button>
</template>

<style scoped>
.count {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 8px;
}
</style>
