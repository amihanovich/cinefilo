// Cliente HTTP para la API REST del backend Railway.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

export type Recommendation = {
  title: string;
  platform: string;
  duration: string;
  type: string;
  year?: string;
  ageRating?: string;
  reason: string;
};

export type RecommendResult = {
  filters: Record<string, string | null>;
  main: Recommendation;
  alternatives: Recommendation[];
  clarification_needed?: string | null;
  cinephile_note?: string | null;
};

export type Message = { role: "user" | "assistant"; content: string };

export async function fetchRecommendation(params: {
  messages: Message[];
  platforms: string[];
  contextHint: string | null;
  seasonHint: string | null;
  weatherHint: string | null;
  excludeTitles: string[];
}): Promise<RecommendResult> {
  const res = await fetch(`${API_BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Error del servidor");
  }
  return res.json() as Promise<RecommendResult>;
}

export async function fetchPoster(title: string, type: string, year?: string): Promise<string | null> {
  // Cinemeta (Stremio catalog) — CORS abierto, sin API key.
  // type: "movie" | "series"
  const mediaType = type === "Serie" ? "series" : "movie";
  try {
    const q = encodeURIComponent(title);
    const url = `https://v3-cinemeta.strem.io/catalog/${mediaType}/top/search=${q}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { metas?: { poster?: string }[] };
    return data.metas?.[0]?.poster ?? null;
  } catch {
    return null;
  }
}

export async function fetchPosters(
  items: { title: string; type: string; year?: string }[]
): Promise<Record<string, string | null>> {
  const results = await Promise.allSettled(
    items.map(async (item) => {
      const poster = await fetchPoster(item.title, item.type, item.year);
      return { title: item.title, poster };
    })
  );
  const map: Record<string, string | null> = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      map[r.value.title] = r.value.poster;
    }
  }
  return map;
}
