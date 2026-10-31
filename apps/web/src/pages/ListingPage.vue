<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, ApiError, type ListingDetail, type PriceHistory } from '../api';
import PriceChart from '../components/PriceChart.vue';
import { isFavorite, toggleFavorite } from '../favorites';
import { currentAmount, formatTokyo, formatTokyoDate, formatYen, PLATFORM_LABEL, SALES_STATUS_LABEL } from '../format';

const props = defineProps<{ id: string }>();

const listing = ref<ListingDetail | null>(null);
const history = ref<PriceHistory | null>(null);
const error = ref<string | null>(null);

watch(() => props.id, async (id) => {
  listing.value = null;
  history.value = null;
  error.value = null;
  try {
    [listing.value, history.value] = await Promise.all([api.listing(id), api.history(id)]);
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 404 ? '找不到这个商品' : (cause as Error).message;
  }
}, { immediate: true });
</script>

<template>
  <main class="page detail">
    <div class="top">
      <button class="round" aria-label="返回" @click="$router.back()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <button v-if="listing" class="round" :class="{ on: isFavorite(listing.id) }" :aria-pressed="isFavorite(listing.id)"
        :aria-label="isFavorite(listing.id) ? '取消收藏' : '收藏'" @click="toggleFavorite(listing.id)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      </button>
    </div>
    <p v-if="error" class="state error" role="alert">{{ error }}</p>
    <div v-else-if="!listing" class="hero skeleton" role="status" aria-label="加载中" />
    <article v-else>
      <img v-if="listing.imageUrl" :src="listing.imageUrl" alt="" class="hero" />
      <div class="head">
        <span class="badge" :class="listing.platform">{{ PLATFORM_LABEL[listing.platform] }}</span>
        <span v-if="listing.productType === 'dlc'" class="badge">DLC</span>
        <span v-if="!listing.isActive" class="badge">已从目录移除</span>
      </div>
      <h1 class="title">{{ listing.title }}</h1>
      <p class="sub">
        {{ listing.publisher ?? '' }}
        <template v-if="listing.releaseDate"> · {{ formatTokyoDate(listing.releaseDate) }} 发售</template>
      </p>

      <section v-if="listing.price" class="panel price">
        <p v-if="listing.price.stale" class="stale">这个价格超过 12 小时没有更新</p>
        <div class="row">
          <strong class="yen" :class="{ sale: listing.price.discountPercent !== null }">{{ formatYen(currentAmount(listing.price)) }}</strong>
          <span v-if="listing.price.discountPercent !== null" class="sticker">-{{ listing.price.discountPercent }}%</span>
        </div>
        <p v-if="listing.price.discountPercent !== null" class="regular">原价 <s>{{ formatYen(listing.price.regularAmountMinor) }}</s></p>
        <div class="facts">
          <span v-if="history?.lowestAmountMinor != null" class="pill" :class="{ good: history.lowestAmountMinor >= currentAmount(listing.price) }">
            {{ history.lowestAmountMinor >= currentAmount(listing.price) ? '史低价' : `史低 ${formatYen(history.lowestAmountMinor)}` }}
          </span>
          <span v-if="listing.price.discountEndAt && listing.price.discountPercent !== null" class="pill">
            截止 {{ formatTokyo(listing.price.discountEndAt) }}
          </span>
          <span class="pill">{{ SALES_STATUS_LABEL[listing.price.salesStatus] ?? listing.price.salesStatus }}</span>
        </div>
        <p class="note">东京时间 · 价格更新于 {{ formatTokyo(listing.price.observedAt) }}</p>
      </section>
      <section v-else class="panel"><p class="note">暂无价格（未定价、已停售或未上架）</p></section>

      <section v-if="history && history.points.length > 0" class="panel">
        <h2>价格走势</h2>
        <PriceChart :points="history.points" />
        <p v-if="history.points.length === 1" class="note">开始追踪以来价格还没有变化。</p>
      </section>

      <a v-if="listing.sourceUrl" :href="listing.sourceUrl" target="_blank" rel="noopener" class="cta">在 My Nintendo Store 打开</a>

      <details v-if="listing.description" class="panel desc">
        <summary>简介</summary>
        <p>{{ listing.description }}</p>
      </details>
    </article>
  </main>
</template>

<style scoped>
.detail { padding-top: calc(4px + env(safe-area-inset-top)); }

.top {
  position: sticky;
  top: calc(8px + env(safe-area-inset-top));
  z-index: 5;
  display: flex;
  justify-content: space-between;
  height: 0;
}

.round {
  width: 40px;
  height: 40px;
  margin: 10px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow);
}

.round svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.round.on { color: var(--accent); }
.round.on svg { fill: currentColor; }

.hero {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  max-height: 420px;
  object-fit: cover;
  border-radius: var(--radius);
  background: var(--surface-2);
  box-shadow: var(--shadow);
}

.head { display: flex; gap: 6px; margin-top: 16px; }
.title { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.35; margin: 8px 0 4px; }
.sub { color: var(--muted); font-size: 14px; margin: 0 0 14px; }

.panel {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: var(--shadow);
}

.panel h2 { font-size: 15px; margin: 0 0 10px; }

.row { display: flex; align-items: center; gap: 12px; }
.row strong { font-size: 36px; line-height: 1.1; }
.row strong.sale { color: var(--sale); }
.row .sticker { font-size: 18px; }
.regular { margin: 4px 0 0; color: var(--muted); font-size: 14px; }

.facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }

.pill {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted);
}

.pill.good { background: var(--good-soft); color: var(--good); }

.note { font-size: 12px; color: var(--muted); margin: 10px 0 0; }

.cta {
  display: block;
  text-align: center;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
  border-radius: 999px;
  padding: 15px;
  margin: 4px 0 14px;
  box-shadow: 0 6px 16px rgb(230 0 18 / 0.25);
}

.desc summary { font-weight: 700; font-size: 15px; cursor: pointer; }
.desc p { white-space: pre-line; font-size: 14px; line-height: 1.75; color: var(--muted); margin: 10px 0 0; }
</style>
