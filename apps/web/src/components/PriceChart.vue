<script setup lang="ts">
import { computed } from 'vue';
import type { PricePoint } from '../api';
import { formatTokyoDate, formatYen } from '../format';

const props = defineProps<{ points: PricePoint[]; now?: Date }>();

const W = 320;
const H = 140;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

// History rows are change points, so the price holds until the next row: draw steps up to now.
const chart = computed(() => {
  const series = props.points.map((point) => ({
    t: new Date(point.observedAt).getTime(),
    amount: point.discountAmountMinor ?? point.regularAmountMinor
  }));
  if (series.length === 0) return null;
  const end = Math.max((props.now ?? new Date()).getTime(), series.at(-1)!.t);
  const start = series[0]!.t;
  const span = Math.max(end - start, 1);
  const amounts = series.map((point) => point.amount);
  const max = Math.max(...amounts);
  const min = Math.min(...amounts);
  const range = Math.max(max - min, max * 0.1, 1);
  const x = (t: number) => PAD.left + ((t - start) / span) * (W - PAD.left - PAD.right);
  // a flat history sits mid-chart instead of on the floor
  const low = max === min ? min - range / 2 : min - range * 0.1;
  const scale = max === min ? range : range * 1.2;
  const y = (amount: number) => PAD.top + (1 - (amount - low) / scale) * (H - PAD.top - PAD.bottom);

  let d = `M${x(series[0]!.t)},${y(series[0]!.amount)}`;
  for (const point of series.slice(1)) d += ` H${x(point.t)} V${y(point.amount)}`;
  d += ` H${x(end)}`;

  return { d, min, max, minY: y(min), startLabel: formatTokyoDate(new Date(start).toISOString()) };
});
</script>

<template>
  <figure v-if="chart" class="chart">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`价格走势，最低 ${formatYen(chart.min)}，最高 ${formatYen(chart.max)}`">
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="chart.minY" :y2="chart.minY" class="floor" />
      <path :d="chart.d" class="line" />
      <text :x="PAD.left" :y="H - 6" class="axis">{{ chart.startLabel }}</text>
      <text :x="W - PAD.right" :y="H - 6" class="axis" text-anchor="end">现在</text>
    </svg>
  </figure>
</template>

<style scoped>
.chart { margin: 0; }
svg { width: 100%; height: auto; display: block; }
.line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; }
.floor { stroke: var(--good); stroke-width: 1; stroke-dasharray: 4 4; }
.axis { font-size: 11px; fill: var(--muted); }
</style>
