// Per-device lists in localStorage; private mode or full storage falls back to memory for the session.
export function loadList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function saveList(key: string, list: readonly string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // keep the in-memory list
  }
}
