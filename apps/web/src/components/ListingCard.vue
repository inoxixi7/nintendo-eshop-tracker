<script setup lang="ts">
import type { Listing } from '../api';
import { currentAmount, endsIn, formatPrice, PLATFORM_LABEL, salesStatusLabel } from '../format';
import { t } from '../i18n';

defineProps<{ listing: Listing }>();
</script>

<template>
  <RouterLink :to="`/listing/${listing.id}`" class="card">
    <img v-if="listing.imageUrl" :src="listing.imageUrl" alt="" loading="lazy" class="thumb" />
    <div v-else class="thumb" aria-hidden="true" />
    <div class="body">
      <h3 class="title">{{ listing.title }}</h3>
      <div class="meta">
        <span class="badge" :class="listing.platform">{{ PLATFORM_LABEL[listing.platform] }}</span>
        <span v-if="listing.productType === 'dlc'" class="tag">DLC</span>
        <span v-if="listing.price?.discountEndAt && listing.price.discountPercent !== null">
          {{ endsIn(listing.price.discountEndAt) }}
        </span>
        <span v-else-if="listing.price && listing.price.salesStatus !== 'onsale'">
          {{ salesStatusLabel(listing.price.salesStatus) }}
        </span>
      </div>
      <div v-if="listing.price" class="price">
        <span v-if="listing.price.discountPercent !== null" class="sticker">-{{ listing.price.discountPercent }}%</span>
        <strong class="yen" :class="{ sale: listing.price.discountPercent !== null }">{{ formatPrice(currentAmount(listing.price), listing.price.currency) }}</strong>
        <s v-if="listing.price.discountPercent !== null">{{ formatPrice(listing.price.regularAmountMinor, listing.price.currency) }}</s>
      </div>
      <div v-else class="price muted">{{ t('price.none') }}</div>
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
  box-shadow: var(--shadow);
}

.card:active { transform: scale(0.99); }

.thumb {
  width: 88px;
  height: 88px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  flex: none;
  background: var(--surface-2);
}

.body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }

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

.meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.tag { font-size: 11px; background: var(--surface-2); padding: 2px 6px; border-radius: 6px; }

.price { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.price .sticker { font-size: 12px; }
.price strong { font-size: 18px; }
.price strong.sale { color: var(--sale); }
.price s { color: var(--muted); font-size: 12px; }
.price.muted { color: var(--muted); font-size: 14px; }
</style>
