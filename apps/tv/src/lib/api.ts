// copiado de apps/mobile/src/lib/api.ts — mantener en sync a mano
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
    // Timeout duro: sin esto, si Railway cuelga el spinner queda infinito.
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`/api/recommend ${res.status}`);
  return res.json() as Promise<RecoResponse>;
}

// Pregunta conversacional sobre el título en pantalla (no re-recomienda).
export async function fetchAsk(params: {
  title: string;
  platform: string;
  question: string;
}): Promise<{ answer: string }> {
  const res = await fetch(`${API_BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`/api/ask ${res.status}`);
  return res.json() as Promise<{ answer: string }>;
}

// Warmup: despierta el server de Railway (cold start) sin bloquear nada.
export function warmupBackend(): void {
  void fetch(`${API_BASE}/api/ping`, { signal: AbortSignal.timeout(10000) }).catch(() => { /* silencioso */ });
}

export { fetchPostersClient as fetchPosters } from "./posters";
