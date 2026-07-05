// Cliente para /api/tv-home — endpoint propio de la TV (tv-search.mjs, ya
// desplegado por Carlos: cacheado 6h + pre-calentado al arrancar el server).
// Se usa para la grilla de pósters "hero" de la pantalla de pairing.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

export type TvHomeItem = {
  title: string;
  platform: string;
  type: string;
  year?: number;
  synopsis?: string;
  reason?: string;
  section?: string;
};

export async function fetchTvHome(): Promise<TvHomeItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/tv-home`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: TvHomeItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

// Carga infinita del rail "Más para explorar" (POST /api/tv-home-more).
export async function fetchTvHomeMore(exclude: string[]): Promise<TvHomeItem[]> {
  try {
    const res = await fetch(`${API_BASE}/api/tv-home-more`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exclude }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: TvHomeItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}
