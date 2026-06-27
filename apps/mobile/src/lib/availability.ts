// Validación de disponibilidad por territorio via TMDB Watch Providers.
// Devuelve si el título está en la plataforma indicada en el país del usuario,
// y el link directo de JustWatch para ese título.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TOKEN = import.meta.env.VITE_TMDB_TOKEN as string;

// Mapa de nuestros nombres de plataforma → provider_ids de TMDB
const PROVIDER_IDS: Record<string, number[]> = {
  Netflix: [8],
  "Prime Video": [9, 10, 119],
  "Disney+": [337],
  Max: [384, 1899],
  "Apple TV+": [350],
  "Paramount+": [531],
  "Star+": [619, 337], // Star+ fue absorbido por Disney+ en LatAm
};

export type AvailabilityResult = {
  confirmed: boolean;       // TMDB confirma que está en esa plataforma en ese país
  jwLink: string | null;    // link JustWatch directo al título en ese país
};

async function tmdb(path: string): Promise<unknown> {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function searchTmdbId(title: string, type: string): Promise<number | null> {
  const endpoint = type === "Serie" ? "/search/tv" : "/search/movie";
  const q = encodeURIComponent(title);
  try {
    const data = await tmdb(`${endpoint}?query=${q}&language=es-AR&page=1`) as {
      results?: { id: number }[];
    };
    return data.results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function getProviders(
  tmdbId: number,
  type: string,
  country: string,
): Promise<{ confirmed: boolean; jwLink: string | null }> {
  const endpoint = type === "Serie" ? `/tv/${tmdbId}/watch/providers` : `/movie/${tmdbId}/watch/providers`;
  try {
    const data = await tmdb(endpoint) as {
      results?: Record<string, {
        link?: string;
        flatrate?: { provider_id: number; provider_name: string }[];
      }>;
    };
    const region = data.results?.[country];
    return {
      confirmed: false, // lo completa checkAvailability con la plataforma
      jwLink: region?.link ?? null,
    };
  } catch {
    return { confirmed: false, jwLink: null };
  }
}

export async function checkAvailability(
  title: string,
  platform: string,
  type: string,
  country: string,
): Promise<AvailabilityResult> {
  if (!TOKEN) return { confirmed: false, jwLink: null };

  const tmdbId = await searchTmdbId(title, type);
  if (!tmdbId) return { confirmed: false, jwLink: null };

  const endpoint = type === "Serie" ? `/tv/${tmdbId}/watch/providers` : `/movie/${tmdbId}/watch/providers`;
  try {
    const data = await tmdb(endpoint) as {
      results?: Record<string, {
        link?: string;
        flatrate?: { provider_id: number }[];
      }>;
    };
    const region = data.results?.[country];
    if (!region) return { confirmed: false, jwLink: null };

    const flatrateIds = (region.flatrate ?? []).map((p) => p.provider_id);
    const wantedIds = PROVIDER_IDS[platform] ?? [];
    const confirmed = wantedIds.some((id) => flatrateIds.includes(id));

    return { confirmed, jwLink: region.link ?? null };
  } catch {
    return { confirmed: false, jwLink: null };
  }
}
