import { ref } from 'vue';

const KEY = 'eshop-tracker:favorites';

function load(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// Favorites live only in this browser; the design defers accounts to a later version.
export const favorites = ref<string[]>(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(favorites.value));
  } catch {
    // private mode or full storage: keep the in-memory list for this session
  }
}

export function isFavorite(id: string): boolean {
  return favorites.value.includes(id);
}

export function toggleFavorite(id: string) {
  favorites.value = isFavorite(id) ? favorites.value.filter((item) => item !== id) : [id, ...favorites.value];
  save();
}
