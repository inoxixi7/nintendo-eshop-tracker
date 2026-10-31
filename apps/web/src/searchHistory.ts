import { ref } from 'vue';
import { loadList, saveList } from './storage';

const KEY = 'eshop-tracker:search-history';
const LIMIT = 10;

export const searchHistory = ref<string[]>(loadList(KEY).slice(0, LIMIT));

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Most recent first; repeating a query moves it to the top instead of duplicating it. */
export function rememberSearch(query: string) {
  const term = query.trim();
  if (term.length === 0) return;
  searchHistory.value = [term, ...searchHistory.value.filter((item) => !same(item, term))].slice(0, LIMIT);
  saveList(KEY, searchHistory.value);
}

export function forgetSearch(query: string) {
  searchHistory.value = searchHistory.value.filter((item) => item !== query);
  saveList(KEY, searchHistory.value);
}

export function clearSearchHistory() {
  searchHistory.value = [];
  saveList(KEY, searchHistory.value);
}
