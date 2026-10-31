import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'eshop-tracker:theme';
const systemDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** The user's explicit choice; null follows the system setting. */
const choice = ref<Theme | null>(saved());
const system = ref<Theme>(systemDark?.matches ? 'dark' : 'light');
systemDark?.addEventListener('change', (event) => { system.value = event.matches ? 'dark' : 'light'; });

export const theme = ref<Theme>(choice.value ?? system.value);

watch([choice, system], () => { theme.value = choice.value ?? system.value; });

watch(theme, (value) => {
  // style.css keys its dark tokens off data-theme
  document.documentElement.dataset.theme = value;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) if (color) meta.content = color;
}, { immediate: true });

export function toggleTheme() {
  choice.value = theme.value === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(STORAGE_KEY, choice.value); } catch { /* keep the choice for this visit only */ }
}
