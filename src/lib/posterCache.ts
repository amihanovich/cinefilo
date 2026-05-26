// Cache de portadas icónicas en localStorage para que el banner aparezca
// instantáneo en la segunda visita en adelante.
const KEY = "iconic-posters-v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

type CachePayload = { urls: string[]; savedAt: number };

export function getCachedIconic(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed?.urls?.length) return [];
    if (Date.now() - parsed.savedAt > TTL_MS) return [];
    return parsed.urls.filter((u) => typeof u === "string");
  } catch {
    return [];
  }
}

export function setCachedIconic(urls: string[]): void {
  if (typeof window === "undefined") return;
  if (!urls.length) return;
  try {
    const payload: CachePayload = { urls, savedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // localStorage lleno o bloqueado — silencioso
  }
}
