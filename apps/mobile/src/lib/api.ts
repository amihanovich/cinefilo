// Cliente REST para el backend de Miru (Railway).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

export type Message = { role: "user" | "assistant"; content: string };

export type Recommendation = {
  title: string;
  platform: string;
  duration: string;
  type: string;
  year?: string;
  ageRating?: string;
  /** De qué va (20-30 palabras) — se muestra en el hero y en la ficha. */
  synopsis?: string;
  /** Qué es + por qué, en UNA línea — para las tarjetas chicas. */
  hook?: string;
  /** El porqué de la recomendación (12-18 palabras). */
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
  /** ISO2 del usuario: el backend valida disponibilidad real en ese país. */
  country?: string;
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

// Orbe del control: manda lo que dijo el usuario + el título centrado, y el
// backend infiere si es una pregunta sobre ese título o un pedido de búsqueda.
export type OrbResult =
  | { mode: "ask"; answer: string }
  | { mode: "search"; query: string };

export async function fetchOrb(params: {
  transcript: string;
  title: string;
  platform: string;
}): Promise<OrbResult> {
  const res = await fetch(`${API_BASE}/api/orb`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`/api/orb ${res.status}`);
  return res.json() as Promise<OrbResult>;
}

// (a.i) Intención inferida: manda el texto libre del pedido y el backend devuelve
// una frase corta ("lo más importante del pedido") para mostrar mientras busca.
// Falla en silencio (devuelve null) si el endpoint no existe todavía (pre-deploy)
// o si hay error de red — así el loading cae al eco literal del texto.
export async function fetchIntent(text: string): Promise<string | null> {
  if (!text.trim()) return null;
  try {
    const res = await fetch(`${API_BASE}/api/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { intent?: string };
    const intent = (data.intent ?? "").trim();
    return intent || null;
  } catch {
    return null;
  }
}

// Warmup: despierta el server de Railway (cold start) sin bloquear nada.
export function warmupBackend(): void {
  void fetch(`${API_BASE}/api/ping`, { signal: AbortSignal.timeout(10000) }).catch(() => { /* silencioso */ });
}

export { fetchPostersClient as fetchPosters } from "./posters";
