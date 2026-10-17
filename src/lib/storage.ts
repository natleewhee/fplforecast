/* localStorage that never throws. Storage can be missing or blocked (private
 * windows, cleared site data, server render), and every caller wants the same
 * thing in that case: carry on as if nothing had been saved. */

export function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembering just means the choice lasts until the page reloads
  }
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Parsed JSON, or `fallback` when nothing is stored, it is unreadable, or storage is unavailable. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeItem(key, JSON.stringify(value));
}
