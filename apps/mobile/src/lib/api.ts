// Cliente REST para el backend de Cinéfilo (Railway).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";
const CINEMETA = "https://v3-cinemeta.strem.io/catalog";

export type Message = { role: "user" | "assistant"; content: string };

export type Recommendation = {
  title: string;
  platform: string;
  duration: string;
  type: string;
  year?: string;
  ageRating?: string;
  reason: string;
};

export type RecoResponse = {
  filters: Record<string, string>;
  main: Recommendation;
  alternatives: Recommendation[];
  clarification_needed: string | null;
  cinephile_note: string | null;
};

export async function fetchRecommendation(params: {
  messages: Message[];
  platforms: string[];
  contextHint: string | null;
  seasonHint: string | null;
  weatherHint: string | null;
  excludeTitles: string[];
}): Promise<RecoResponse> {
  const res = await fetch(`${API_BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`/api/recommend ${res.status}`);
  return res.json() as Promise<RecoResponse>;
}

export async function fetchPosters(
  items: { title: string; type: string; year?: string }[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  await Promise.allSettled(
    items.map(async (item) => {
      const kind = item.type === "Serie" ? "series" : "movie";
      const q = encodeURIComponent(item.title);
      try {
        const res = await fetch(`${CINEMETA}/${kind}/top/search=${q}.json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) { result[item.title] = null; return; }
        const data = await res.json() as { metas?: { poster?: string }[] };
        result[item.title] = data.metas?.[0]?.poster ?? null;
      } catch {
        result[item.title] = null;
      }
    }),
  );
  return result;
}
