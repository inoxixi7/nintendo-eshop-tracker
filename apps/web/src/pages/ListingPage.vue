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
  <main class="page">
    <button class="back" @click="$router.back()">‹ 返回</button>
    <p v-if="error" class="state error" role="alert">{{ error }}</p>
    <p v-else-if="!listing" class="state" role="status">加载中…</p>
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
          <span v-if="listing.price.discountPercent !== null" class="off">-{{ listing.price.discountPercent }}%</span>
          <strong :class="{ sale: listing.price.discountPercent !== null }">{{ formatYen(currentAmount(listing.price)) }}</strong>
          <s v-if="listing.price.discountPercent !== null">{{ formatYen(listing.price.regularAmountMinor) }}</s>
        </div>
        <p v-if="listing.price.discountEndAt && listing.price.discountPercent !== null" class="note">
          折扣截止 {{ formatTokyo(listing.price.discountEndAt) }}（东京时间）
        </p>
        <p class="note">
          {{ SALES_STATUS_LABEL[listing.price.salesStatus] ?? listing.price.salesStatus }}
          · 更新于 {{ formatTokyo(listing.price.observedAt) }}
        </p>
        <p v-if="history?.lowestAmountMinor != null" class="note low">
          记录内最低 {{ formatYen(history.lowestAmountMinor) }}
          <template v-if="history.lowestAmountMinor >= currentAmount(listing.price)">（当前就是最低）</template>
        </p>
      </section>
      <section v-else class="panel"><p class="note">暂无价格（未定价、已停售或未上架）</p></section>

      <section v-if="history && history.points.length > 0" class="panel">
        <h2>价格历史</h2>
        <PriceChart :points="history.points" />
        <p v-if="history.points.length === 1" class="note">追踪开始后价格还没有变化过。</p>
      </section>

      <div class="actions">
        <button class="action" :class="{ on: isFavorite(listing.id) }" :aria-pressed="isFavorite(listing.id)" @click="toggleFavorite(listing.id)">
          {{ isFavorite(listing.id) ? '♥ 已收藏' : '♡ 收藏' }}
        </button>
        <a v-if="listing.sourceUrl" :href="listing.sourceUrl" target="_blank" rel="noopener" class="action primary">在 My Nintendo Store 打开</a>
      </div>

      <p v-if="listing.description" class="desc">{{ listing.description }}</p>
    </article>
  </main>
</template>

<style scoped>
.back {
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 16px;
  padding: 8px 0;
  cursor: pointer;
}

.hero {
  width: 100%;
  aspect-ratio: 1;
  max-height: 360px;
  object-fit: cover;
  border-radius: var(--radius);
  background: var(--surface-2);
}

.head { display: flex; gap: 6px; margin-top: 12px; }
.title { font-size: 21px; line-height: 1.35; margin: 8px 0 4px; }
.sub { color: var(--muted); font-size: 14px; margin: 0 0 12px; }

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 12px;
}

.panel h2 { font-size: 15px; margin: 0 0 8px; }

.row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.row strong { font-size: 28px; }
.row strong.sale { color: var(--sale); }
.row s { color: var(--muted); }

.off {
  background: var(--sale);
  color: #fff;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 8px;
}

.note { font-size: 13px; color: var(--muted); margin: 6px 0 0; }
.note.low { color: var(--good); font-weight: 600; }

.actions { display: flex; gap: 10px; margin-bottom: 16px; }

.action {
  flex: 1;
  text-align: center;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 12px;
  padding: 12px;
  font-size: 15px;
  cursor: pointer;
}

.action.on { color: var(--accent); border-color: var(--accent); }
.action.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }

.desc { white-space: pre-line; font-size: 14px; line-height: 1.7; color: var(--muted); }
</style>
