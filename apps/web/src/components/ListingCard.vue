<script setup lang="ts">
import type { Listing } from '../api';
import { currentAmount, endsIn, formatYen, PLATFORM_LABEL, SALES_STATUS_LABEL } from '../format';

defineProps<{ listing: Listing }>();
</script>

<template>
  <RouterLink :to="`/listing/${listing.id}`" class="card">
    <img v-if="listing.imageUrl" :src="listing.imageUrl" alt="" loading="lazy" class="thumb" />
    <div v-else class="thumb empty" aria-hidden="true" />
    <div class="body">
      <h3 class="title">{{ listing.title }}</h3>
      <div class="meta">
        <span class="badge" :class="listing.platform">{{ PLATFORM_LABEL[listing.platform] }}</span>
        <span v-if="listing.productType === 'dlc'" class="tag">DLC</span>
        <span v-if="listing.price?.discountEndAt && listing.price.discountPercent !== null" class="ends">
          {{ endsIn(listing.price.discountEndAt) }}
        </span>
      </div>
      <div v-if="listing.price" class="price">
        <span v-if="listing.price.discountPercent !== null" class="off">-{{ listing.price.discountPercent }}%</span>
        <strong :class="{ sale: listing.price.discountPercent !== null }">{{ formatYen(currentAmount(listing.price)) }}</strong>
        <s v-if="listing.price.discountPercent !== null">{{ formatYen(listing.price.regularAmountMinor) }}</s>
        <span v-if="listing.price.salesStatus !== 'onsale'" class="status">
          {{ SALES_STATUS_LABEL[listing.price.salesStatus] ?? listing.price.salesStatus }}
        </span>
      </div>
      <div v-else class="price muted">暂无价格</div>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: flex;
  gap: 12px;
  background: var(--surface);
  border-radius: var(--radius);
  padding: 10px;
  border: 1px solid var(--line);
}

.card:active { transform: scale(0.99); }

.thumb {
  width: 96px;
  height: 96px;
  border-radius: 10px;
  object-fit: cover;
  flex: none;
  background: var(--surface-2);
}

.body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.tag {
  font-size: 11px;
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 6px;
}

.price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}

.price strong { font-size: 18px; }
.price strong.sale { color: var(--sale); }
.price s { color: var(--muted); font-size: 13px; }
.price.muted { color: var(--muted); font-size: 14px; }

.off {
  background: var(--sale);
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 6px;
}

.status { font-size: 12px; color: var(--muted); }
</style>
