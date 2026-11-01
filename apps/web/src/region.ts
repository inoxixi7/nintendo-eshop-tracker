import { ref, watch } from 'vue';

/** Stores the API serves; the choice is remembered per device. */
export const REGIONS = ['JP', 'US'] as const;
export type Region = (typeof REGIONS)[number];

const STORAGE_KEY = 'eshop-tracker:region';

function initialRegion(): Region {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if ((REGIONS as readonly (string | null)[]).includes(saved)) return saved as Region;
  } catch { /* storage unavailable */ }
  return 'JP';
}

export const region = ref<Region>(initialRegion());

watch(region, (value) => {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* keep the choice for this visit only */ }
});
