<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, ApiError, type ListingDetail, type PriceHistory } from '../api';
import PriceChart from '../components/PriceChart.vue';
import { isFavorite, toggleFavorite } from '../favorites';
import { currentAmount, endsIn, formatTokyo, formatTokyoDate, formatYen, PLATFORM_LABEL, salesStatusLabel } from '../format';
import { genreLabel, t } from '../i18n';

const props = defineProps<{ id: string }>();

const listing = ref<ListingDetail | null>(null);
const history = ref<PriceHistory | null>(null);
const error = ref<string | null>(null);
const expanded = ref(false);
const scrolled = ref(false);

watch(() => props.id, async (id) => {
  listing.value = null;
  history.value = null;
  error.value = null;
  expanded.value = false;
  try {
    [listing.value, history.value] = await Promise.all([api.listing(id), api.history(id)]);
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 404 ? t('detail.notFound') : (cause as Error).message;
  }
}, { immediate: true });

// the compact title bar takes over once the artwork has scrolled away
const onScroll = () => { scrolled.value = window.scrollY > 260; };
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
onUnmounted(() => window.removeEventListener('scroll', onScroll));

const deal = computed(() => {
  const price = listing.value?.price;
  if (!price) return null;
  const now = currentAmount(price);
  const onSale = price.discountPercent !== null;
  const lowest = history.value?.lowestAmountMinor ?? null;
  const start = price.discountStartAt ? new Date(price.discountStartAt).getTime() : null;
  const end = price.discountEndAt ? new Date(price.discountEndAt).getTime() : null;
  return {
    now,
    onSale,
    saved: price.regularAmountMinor - now,
    atLowest: lowest !== null && now <= lowest,
    aboveLowest: lowest !== null && now > lowest ? now - lowest : null,
    lowest,
    endsIn: onSale && end !== null ? endsIn(price.discountEndAt!) : null,
    urgent: onSale && end !== null && end - Date.now() < 48 * 3_600_000,
    // share of the sale window already gone, for the countdown bar
    elapsed: onSale && start !== null && end !== null && end > start
      ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start)))
      : null
  };
});

const changed = computed(() => (history.value?.points.length ?? 0) > 1);
const highest = computed(() => Math.max(...(history.value?.points ?? []).map((point) => point.discountAmountMinor ?? point.regularAmountMinor)));
</script>

<template>
  <main class="detail">
    <header class="bar" :class="{ solid: scrolled }">
      <button class="round" :aria-label="t('detail.back')" @click="$router.back()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <p class="bar-title" :aria-hidden="!scrolled">{{ listing?.title }}</p>
      <button v-if="listing" class="round" :class="{ on: isFavorite(listing.id) }" :aria-pressed="isFavorite(listing.id)"
        :aria-label="t(isFavorite(listing.id) ? 'detail.unfavorite' : 'detail.favorite')" @click="toggleFavorite(listing.id)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
      </button>
      <span v-else class="round-space" />
    </header>

    <p v-if="error" class="state error body" role="alert">{{ error }}</p>
    <div v-else-if="!listing" class="stage" role="status" :aria-label="t('feed.loading')"><div class="cover skeleton" /></div>
    <article v-else>
      <div class="stage">
        <div v-if="listing.imageUrl" class="backdrop" :style="{ backgroundImage: `url(${listing.imageUrl})` }" />
        <img v-if="listing.imageUrl" :src="listing.imageUrl" alt="" class="cover" />
        <div v-else class="cover blank" />
      </div>

      <div class="body">
        <div class="tags">
          <span class="badge" :class="listing.platform">{{ PLATFORM_LABEL[listing.platform] }}</span>
          <span v-if="listing.productType !== 'game'" class="badge">{{ t(`type.${listing.productType}`) }}</span>
          <span v-if="!listing.isActive" class="badge">{{ t('detail.removed') }}</span>
        </div>
        <h1 class="title">{{ listing.title }}</h1>
        <p v-if="listing.publisher" class="publisher">{{ listing.publisher }}</p>

        <section v-if="listing.price && deal" class="card price" :aria-label="t('detail.price')">
          <p v-if="listing.price.stale" class="stale">{{ t('stale.price') }}</p>
          <div class="price-row">
            <div>
              <p class="label">{{ t(deal.onSale ? 'price.sale' : 'price.current') }}</p>
              <strong class="big yen" :class="{ sale: deal.onSale }">{{ formatYen(deal.now) }}</strong>
              <p v-if="deal.onSale" class="was">
                <s>{{ formatYen(listing.price.regularAmountMinor) }}</s>
                <span class="save">{{ t('price.save', { amount: formatYen(deal.saved) }) }}</span>
              </p>
            </div>
            <span v-if="deal.onSale" class="sticker big-sticker">-{{ listing.price.discountPercent }}%</span>
          </div>

          <div v-if="deal.endsIn" class="countdown" :class="{ urgent: deal.urgent }">
            <div class="countdown-text">
              <span>{{ deal.endsIn }}</span>
              <span class="muted">{{ t('price.ends', { time: formatTokyo(listing.price.discountEndAt!) }) }}</span>
            </div>
            <div v-if="deal.elapsed !== null" class="track" aria-hidden="true">
              <div class="fill" :style="{ width: `${(1 - deal.elapsed) * 100}%` }" />
            </div>
          </div>

          <p v-if="deal.atLowest" class="verdict good">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
            {{ t('price.atLowest') }}
          </p>
          <p v-else-if="deal.aboveLowest !== null" class="verdict">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v5M12 16v.01" /></svg>
            {{ t('price.aboveLowest', { low: formatYen(deal.lowest!), diff: formatYen(deal.aboveLowest) }) }}
          </p>
        </section>
        <section v-else class="card empty-price">
          <p class="label">{{ t('price.none') }}</p>
          <p class="muted small">{{ t('price.noneSub') }}</p>
        </section>

        <section v-if="history && history.points.length > 0" class="card" aria-labelledby="trend">
          <h2 id="trend">{{ t('detail.trend') }}</h2>
          <template v-if="changed">
            <div class="stats">
              <div><span class="muted small">{{ t('detail.lowest') }}</span><strong class="yen good-ink">{{ formatYen(history.lowestAmountMinor!) }}</strong></div>
              <div><span class="muted small">{{ t('detail.highest') }}</span><strong class="yen">{{ formatYen(highest) }}</strong></div>
              <div><span class="muted small">{{ t('detail.changes') }}</span><strong>{{ t('detail.changeCount', { n: history.points.length - 1 }) }}</strong></div>
            </div>
            <PriceChart :points="history.points" />
          </template>
          <p v-else class="flat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /></svg>
            <span>{{ t('detail.flat', { date: formatTokyoDate(history.points[0]!.observedAt) }) }}</span>
          </p>
        </section>

        <section class="card" aria-labelledby="info">
          <h2 id="info">{{ t('detail.info') }}</h2>
          <dl class="facts">
            <div v-if="listing.genres.length > 0" class="genre-row">
              <dt>{{ t('detail.genres') }}</dt>
              <dd class="genre-list"><span v-for="genre in listing.genres" :key="genre" class="genre">{{ genreLabel(genre) }}</span></dd>
            </div>
            <div><dt>{{ t('detail.platform') }}</dt><dd>{{ PLATFORM_LABEL[listing.platform] }}</dd></div>
            <div><dt>{{ t('detail.type') }}</dt><dd>{{ t(`type.${listing.productType}`) }}</dd></div>
            <div v-if="listing.publisher"><dt>{{ t('detail.publisher') }}</dt><dd>{{ listing.publisher }}</dd></div>
            <div v-if="listing.releaseDate"><dt>{{ t('detail.release') }}</dt><dd>{{ formatTokyoDate(listing.releaseDate) }}</dd></div>
            <div v-if="listing.price"><dt>{{ t('detail.status') }}</dt><dd>{{ salesStatusLabel(listing.price.salesStatus) }}</dd></div>
          </dl>
        </section>

        <section v-if="listing.description" class="card" aria-labelledby="about">
          <h2 id="about">{{ t('detail.about') }}</h2>
          <p class="desc" :class="{ clamped: !expanded }">{{ listing.description }}</p>
          <button v-if="listing.description.length > 120" class="more" :aria-expanded="expanded" @click="expanded = !expanded">
            {{ t(expanded ? 'detail.collapse' : 'detail.expand') }}
          </button>
        </section>
      </div>

      <div v-if="listing.sourceUrl" class="buy">
        <div class="buy-price">
          <strong class="yen" :class="{ sale: deal?.onSale }">{{ deal ? formatYen(deal.now) : t('price.none') }}</strong>
          <span v-if="deal?.onSale" class="muted small">-{{ listing.price!.discountPercent }}%</span>
        </div>
        <a :href="listing.sourceUrl" target="_blank" rel="noopener" class="buy-button">
          {{ t('detail.buy') }}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
        </a>
      </div>
    </article>
  </main>
</template>

<style scoped>
.detail {
  max-width: 720px;
  margin: 0 auto;
  padding-bottom: calc(112px + env(safe-area-inset-bottom));
}

/* top bar: floating round buttons over the art, a solid title bar once scrolled */
.bar {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(60px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 10px 0;
  margin-bottom: calc(-60px - env(safe-area-inset-top));
  transition: background 200ms ease, box-shadow 200ms ease;
}

.bar.solid {
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: saturate(1.6) blur(18px);
  -webkit-backdrop-filter: saturate(1.6) blur(18px);
  box-shadow: 0 1px 0 var(--line);
}

.bar-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 200ms ease, transform 200ms ease;
}

.bar.solid .bar-title { opacity: 1; transform: none; }

.round, .round-space { width: 40px; height: 40px; flex: none; }

.round {
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow);
}

.bar.solid .round { box-shadow: none; background: transparent; }
.round svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.round.on { color: var(--accent); }
.round.on svg { fill: currentColor; }

/* artwork stage: the cover floats on a blurred wash of itself */
.stage {
  position: relative;
  overflow: hidden;
  display: grid;
  place-items: center;
  padding: calc(64px + env(safe-area-inset-top)) 0 28px;
}

.backdrop {
  position: absolute;
  /* no bottom overhang, so the fade reaches transparent before the stage clips it */
  inset: -40px -40px 0;
  background-size: cover;
  background-position: center;
  filter: blur(36px) saturate(1.5);
  opacity: 0.55;
  mask-image: linear-gradient(to bottom, #000 40%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent);
}

.cover {
  position: relative;
  width: min(68vw, 300px);
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 22px;
  background: var(--surface-2);
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(255 255 255 / 0.08);
}

.body { padding: 0 16px; }

.tags { display: flex; justify-content: center; gap: 6px; }

.title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.35;
  text-align: center;
  margin: 10px 0 2px;
  text-wrap: balance;
}

.publisher { text-align: center; color: var(--muted); font-size: 14px; margin: 0 0 18px; }

.card {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: var(--shadow);
}

.card h2 { font-size: 16px; margin: 0 0 12px; }

.label { margin: 0; font-size: 13px; font-weight: 600; color: var(--muted); }
.muted { color: var(--muted); }
.small { font-size: 12px; }

.price-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.big { display: block; font-size: 40px; line-height: 1.1; margin-top: 2px; letter-spacing: -0.02em; }
.big.sale, .buy-price .sale { color: var(--sale); }
.was { margin: 4px 0 0; font-size: 14px; color: var(--muted); display: flex; gap: 10px; align-items: center; }
.save { color: var(--good); font-weight: 700; }
.big-sticker { font-size: 20px; padding: 6px 12px; margin-top: 8px; }

.countdown {
  margin-top: 14px;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.countdown-text { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 700; }
.countdown-text .muted { font-weight: 500; font-size: 13px; }
.countdown.urgent { background: var(--accent-soft); }
.countdown.urgent .countdown-text > span:first-child { color: var(--sale); }

.track { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--muted) 22%, transparent); margin-top: 10px; overflow: hidden; }
.fill { height: 100%; border-radius: inherit; background: var(--text); }
.countdown.urgent .fill { background: var(--sale); }

.verdict {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
}

.verdict svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.verdict.good { color: var(--good); }

.empty-price { text-align: center; padding: 22px 16px; }
.empty-price .small { margin: 4px 0 0; }

.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.stats div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); }
.stats strong { font-size: 16px; }
.good-ink { color: var(--good); }

.flat { display: flex; gap: 10px; align-items: flex-start; margin: 0; font-size: 14px; line-height: 1.6; color: var(--muted); }
.flat svg { width: 20px; height: 20px; flex: none; margin-top: 1px; fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; }

.facts { margin: 0; }
.facts div { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; font-size: 14px; }
.facts div + div { border-top: 1px solid var(--line); }
.facts dt { color: var(--muted); flex: none; }
.facts dd { margin: 0; text-align: right; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.genre-row { align-items: center; }
.genre-list { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.genre { font-size: 12px; font-weight: 650; padding: 3px 10px; border-radius: 999px; background: var(--surface-2); }

.desc { white-space: pre-line; font-size: 14px; line-height: 1.8; color: var(--muted); margin: 0; }
.desc.clamped { display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.more { border: 0; background: none; padding: 8px 0 0; color: var(--accent); font-weight: 700; font-size: 14px; }

/* purchase bar replaces the tab bar on this page, so the action is always one thumb away */
.buy {
  position: fixed;
  inset: auto 12px calc(12px + env(safe-area-inset-bottom));
  max-width: 696px;
  margin: 0 auto;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 8px 8px 18px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  backdrop-filter: saturate(1.6) blur(16px);
  -webkit-backdrop-filter: saturate(1.6) blur(16px);
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.16), 0 0 0 1px var(--line);
}

.buy-price { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.buy-price strong { font-size: 20px; white-space: nowrap; }

.buy-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 46px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 6px 16px rgb(230 0 18 / 0.3);
}

.buy-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }

@media (min-width: 720px) {
  .stage { padding-top: 84px; }
}
</style>
