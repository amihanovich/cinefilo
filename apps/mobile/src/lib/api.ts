// Cliente REST para el backend de Cinéfilo (Railway).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

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
  alternativesCount?: number;
}): Promise<RecoResponse> {
  const res = await fetch(`${API_BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`/api/recommend ${res.status}`);
  return res.json() as Promise<RecoResponse>;
}

export { fetchPostersClient as fetchPosters } from "./posters";
