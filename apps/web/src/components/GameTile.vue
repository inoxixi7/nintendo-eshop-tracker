<script setup lang="ts">
import { computed } from 'vue';
import type { Listing } from '../api';
import { currentAmount, endsIn, formatYen, PLATFORM_LABEL } from '../format';

const props = defineProps<{ listing: Listing }>();

const onSale = computed(() => props.listing.price?.discountPercent != null);
const urgent = computed(() => {
  const end = props.listing.price?.discountEndAt;
  return onSale.value && end != null && new Date(end).getTime() - Date.now() < 48 * 3_600_000;
});
</script>

<template>
  <RouterLink :to="`/listing/${listing.id}`" class="tile">
    <div class="art">
      <img v-if="listing.imageUrl" :src="listing.imageUrl" alt="" loading="lazy" />
      <span v-if="onSale" class="sticker">-{{ listing.price!.discountPercent }}%</span>
      <span v-if="onSale && listing.price!.discountEndAt" class="ends" :class="{ urgent }">
        {{ endsIn(listing.price!.discountEndAt) }}
      </span>
    </div>
    <h3 class="title">{{ listing.title }}</h3>
    <div v-if="listing.price" class="price">
      <strong class="yen" :class="{ sale: onSale }">{{ formatYen(currentAmount(listing.price)) }}</strong>
      <s v-if="onSale">{{ formatYen(listing.price.regularAmountMinor) }}</s>
    </div>
    <div v-else class="price none">暂无价格</div>
    <span class="platform" :class="listing.platform">{{ PLATFORM_LABEL[listing.platform] }}</span>
  </RouterLink>
</template>

<style scoped>
.tile { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tile:active .art { transform: scale(0.98); }

.art {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: var(--shadow);
  transition: transform 120ms ease;
}

.art img { width: 100%; height: 100%; object-fit: cover; display: block; }

.art .sticker { position: absolute; top: 8px; left: 8px; font-size: 15px; }

.ends {
  position: absolute;
  left: 8px;
  bottom: 8px;
  font-size: 11px;
  font-weight: 650;
  padding: 3px 8px;
  border-radius: 999px;
  color: #fff;
  background: rgb(0 0 0 / 0.58);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.ends.urgent { background: var(--sale); }

.title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  margin: 2px 2px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.price { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px; margin: 0 2px; }
.price strong { font-size: 18px; }
.price strong.sale { color: var(--sale); }
.price s { color: var(--muted); font-size: 12px; }
.price.none { color: var(--muted); font-size: 13px; }

.platform { margin: 0 2px; font-size: 11px; font-weight: 700; color: var(--muted); }
.platform.switch2 { color: var(--text); }
</style>
