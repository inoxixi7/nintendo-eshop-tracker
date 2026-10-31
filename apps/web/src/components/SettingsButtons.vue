<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue';
import { locale, LOCALES, t, type Locale } from '../i18n';
import { theme, toggleTheme } from '../theme';

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);

function closeOnOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}

async function toggleMenu() {
  open.value = !open.value;
  if (!open.value) return close();
  document.addEventListener('pointerdown', closeOnOutside);
  await nextTick();
  menu.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
}

function close() {
  open.value = false;
  document.removeEventListener('pointerdown', closeOnOutside);
}

function choose(code: Locale) {
  locale.value = code;
  close();
  root.value?.querySelector<HTMLElement>('.lang')?.focus();
}

onUnmounted(close);
</script>

<template>
  <div ref="root" class="settings" @keydown.esc="close">
    <button class="icon lang" :aria-label="t('settings.language')" :aria-expanded="open" aria-haspopup="menu" @click="toggleMenu">
      <!-- globe inside a circular arrow: "switch language" -->
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
        <path d="M20.5 3.5V7.5h-4" />
        <circle cx="12" cy="12" r="3.6" />
        <ellipse cx="12" cy="12" rx="1.5" ry="3.6" />
      </svg>
    </button>
    <div v-if="open" ref="menu" class="menu" role="menu" :aria-label="t('settings.language')">
      <button v-for="option in LOCALES" :key="option.code" role="menuitemradio" :aria-checked="locale === option.code"
        :lang="option.code" @click="choose(option.code)">
        <span>{{ option.label }}</span>
        <svg v-if="locale === option.code" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
      </button>
    </div>
    <button class="icon" :aria-label="t(theme === 'dark' ? 'settings.toLight' : 'settings.toDark')" @click="toggleTheme">
      <svg v-if="theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
    </button>
  </div>
</template>

<style scoped>
.settings { position: relative; display: flex; gap: 8px; flex: none; }

.icon {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow), 0 0 0 1px var(--line);
}

.icon[aria-expanded="true"] { box-shadow: 0 0 0 2px var(--accent); }
.icon svg, .menu svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 48px;
  z-index: 20;
  min-width: 168px;
  padding: 6px;
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.18), 0 0 0 1px var(--line);
}

.menu button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: none;
  font-size: 15px;
  text-align: left;
}

.menu button:hover, .menu button:focus-visible { background: var(--surface-2); outline: none; }
.menu button[aria-checked="true"] { font-weight: 700; color: var(--accent); }
.menu svg { width: 18px; height: 18px; stroke-width: 2.4; }
</style>
