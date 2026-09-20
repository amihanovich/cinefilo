// Cliente REST para el backend de Miru (Railway).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://miru-ai.up.railway.app";

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
  /** Modo conversación: el perfil de gusto del dispositivo (texto ya armado por lib/taste.ts). */
  tasteProfile?: string | null;
  /** Modo conversación: descartes de ESTA charla, con lo que dijo el usuario como motivo. */
  rejected?: { title: string; reason: string | null }[];
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

// La memoria del videoclub: manda las señales crudas y vuelve el perfil de
// gusto sintetizado. Falla en silencio (null): el perfil anterior sigue valiendo.
export type TasteProfile = {
  summary: string;
  likes: string[];
  avoid: string[];
  patterns: string;
  asks: string;
  confidence: "baja" | "media" | "alta";
};

export async function fetchProfile(signals: {
  requests: { q: string; ts: string; source: "text" | "voice" }[];
  opened: { title: string; platform: string; ts: string; q: string }[];
  rejected: { title: string; reason: string | null; ts: string }[];
  verdicts: { title: string; verdict: string; stage: string; ts: string }[];
  sessions: string[];
  previous: { summary: string; likes: string[]; avoid: string[] } | null;
}): Promise<TasteProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const p = (await res.json()) as Partial<TasteProfile>;
    if (!p || typeof p.summary !== "string" || !p.summary.trim()) return null;
    return {
      summary: p.summary,
      likes: Array.isArray(p.likes) ? p.likes.filter((x): x is string => typeof x === "string") : [],
      avoid: Array.isArray(p.avoid) ? p.avoid.filter((x): x is string => typeof x === "string") : [],
      patterns: typeof p.patterns === "string" ? p.patterns : "",
      asks: typeof p.asks === "string" ? p.asks : "",
      confidence: p.confidence === "alta" || p.confidence === "media" ? p.confidence : "baja",
    };
  } catch {
    return null;
  }
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

// Tiras "Top 6 en X" del home (catálogo por plataforma, popularidad TMDB por
// región). Mismo caché de 6h que el home de la TV; el server lo tiene listo.
export type TopItem = {
  title: string;
  platform: string;
  type?: string;
  year?: number;
  posterUrl?: string;
  synopsis?: string;
  hook?: string;
  reason?: string;
};
export type TopPlatformRow = { platform: string; items: TopItem[] };

export async function fetchTopPlatforms(): Promise<TopPlatformRow[]> {
  const res = await fetch(`${API_BASE}/api/top-platforms`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { rows?: TopPlatformRow[] };
  return Array.isArray(data.rows) ? data.rows : [];
}

// Warmup: despierta el server de Railway (cold start) sin bloquear nada.
export function warmupBackend(): void {
  void fetch(`${API_BASE}/api/ping`, { signal: AbortSignal.timeout(10000) }).catch(() => { /* silencioso */ });
}

export { fetchPostersClient as fetchPosters } from "./posters";
