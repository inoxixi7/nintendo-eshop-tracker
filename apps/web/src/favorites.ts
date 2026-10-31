import { ref } from 'vue';
import { loadList, saveList } from './storage';

const KEY = 'eshop-tracker:favorites';

// Favorites live only in this browser; the design defers accounts to a later version.
export const favorites = ref<string[]>(loadList(KEY));

export function isFavorite(id: string): boolean {
  return favorites.value.includes(id);
}

export function toggleFavorite(id: string) {
  favorites.value = isFavorite(id) ? favorites.value.filter((item) => item !== id) : [id, ...favorites.value];
  saveList(KEY, favorites.value);
}
