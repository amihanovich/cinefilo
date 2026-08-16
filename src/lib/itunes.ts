// Poster fetching (client-side): Cinemeta (catálogo de Stremio) como fuente
// PRINCIPAL, con iTunes + Wikipedia como respaldo. Las tres soportan CORS desde
// el browser. Estándar único de pósters en todo Miru (móvil, TV y web) — ver
// ARCHITECTURE.md. Mantiene las firmas públicas `fetchPosterClient` /
// `fetchPostersClient` (los consumidores no cambian).
//
// Cinemeta es mucho más confiable que iTunes: sin rate-limiting agresivo y los
// pósters salen del CDN de Stremio (images.metahub.space). iTunes quedaba sin
// póster cuando se disparaban muchas búsquedas en ráfaga.

// Caché en memoria: una vez resuelto un título, no se vuelve a pedir.
const posterCache = new Map<string, string | null>();

function upscale(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, "/600x600bb.$1");
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/:\s*(temporada|season|capítulo|chapter)\s*\d+.*/i, "")
    .replace(/,?\s*(temporada|season)\s*\d+.*/i, "")
    .replace(/\s*[-–]\s*(temporada|season)\s*\d+.*/i, "")
    .trim();
}

function stripArticle(title: string): string {
  return title.replace(/^(el|la|los|las|un|una|the|a|an)\s+/i, "").trim();
}

function isSeries(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("serie") || t.includes("capítulo") || t.includes("capitulo");
}

function titleScore(result: string, expected: string): number {
  const r = result.toLowerCase().trim();
  const e = expected.toLowerCase().trim();
  if (r === e) return 3;
  if (r.startsWith(e) || e.startsWith(r)) return 2;
  if (r.includes(e) || e.includes(r)) return 1;
  return 0;
}

// Cinemeta (Stremio): fuente principal de pósters. Busca en el catálogo por título.
async function searchCinemeta(title: string, type: string): Promise<string | null> {
  const cType = isSeries(type) ? "series" : "movie";
  try {
    const url = `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(title)}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { metas?: Array<{ name?: string; poster?: string }> };
    const metas = data.metas ?? [];
    if (metas.length === 0) return null;

    let best = metas[0];
    let bestScore = -1;
    for (const m of metas) {
      const score = titleScore(m.name ?? "", title);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best.poster ?? null;
  } catch {
    return null;
  }
}

async function searchItunes(
  title: string,
  media: "movie" | "tvShow",
  country: string,
): Promise<string | null> {
  try {
    const entity = media === "movie" ? "movie" : "tvSeason";
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=${media}&entity=${entity}&limit=5&country=${country}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ artworkUrl100?: string; trackName?: string; collectionName?: string }> };
    const results = data.results ?? [];
    if (results.length === 0) return null;

    let best = results[0];
    let bestScore = -1;
    for (const r of results) {
      const name = r.trackName ?? r.collectionName ?? "";
      const score = titleScore(name, title);
      if (score > bestScore) { bestScore = score; best = r; }
    }

    const art = best.artworkUrl100;
    if (!art) return null;
    return upscale(art);
  } catch {
    return null;
  }
}

async function searchWikipedia(title: string, year?: string): Promise<string | null> {
  const queries: string[] = [`${title} film`];
  if (year) queries.push(`${title} ${year}`);

  const tryQuery = async (q: string, lang = "en"): Promise<string | null> => {
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query` +
        `&titles=${encodeURIComponent(q)}` +
        `&prop=pageimages&pithumbsize=600&format=json&origin=*`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { query?: { pages?: Record<string, { missing?: string; thumbnail?: { source?: string } }> } };
      const pages = data?.query?.pages ?? {};
      const page = Object.values(pages)[0];
      if (!page || "missing" in page) return null;
      return page.thumbnail?.source ?? null;
    } catch {
      return null;
    }
  };

  const results = await Promise.all([
    ...queries.map((q) => tryQuery(q, "en")),
    tryQuery(title, "es"),
  ]);
  return results.find(Boolean) ?? null;
}

export async function fetchPosterClient(title: string, type: string, year?: string): Promise<string | null> {
  if (posterCache.has(title)) return posterCache.get(title) ?? null;

  const clean = normalizeTitle(title);
  const noArticle = stripArticle(clean);
  const media: "movie" | "tvShow" = isSeries(type) ? "tvShow" : "movie";
  const altMedia: "movie" | "tvShow" = media === "movie" ? "tvShow" : "movie";

  const deadline = new Promise<null>((r) => setTimeout(() => r(null), 7000));

  const search = async (): Promise<string | null> => {
    // Ronda 1: Cinemeta (Stremio) — fuente principal, confiable.
    const cineMain = await searchCinemeta(clean, type);
    if (cineMain) return cineMain;
    // Cinemeta con el otro tipo (a veces la IA marca mal película/serie)
    const cineAlt = await searchCinemeta(clean, isSeries(type) ? "Película" : "Serie");
    if (cineAlt) return cineAlt;

    // Ronda 2: iTunes (US + AR) en paralelo — respaldo.
    const [usMain, arMain] = await Promise.all([
      searchItunes(clean, media, "us"),
      searchItunes(clean, media, "ar"),
    ]);
    if (usMain ?? arMain) return usMain ?? arMain;

    // Ronda 3: iTunes media alternativo + sin artículo + ES.
    const [usAlt, arAlt, usNo, esMain] = await Promise.all([
      searchItunes(clean, altMedia, "us"),
      searchItunes(clean, altMedia, "ar"),
      noArticle !== clean ? searchItunes(noArticle, media, "us") : Promise.resolve(null),
      searchItunes(clean, media, "es"),
    ]);
    const itunesResult = usAlt ?? arAlt ?? usNo ?? esMain ?? null;
    if (itunesResult) return itunesResult;

    // Ronda 4: Wikipedia fallback
    return searchWikipedia(clean, year);
  };

  const result = await Promise.race([search(), deadline]);
  posterCache.set(title, result);
  return result;
}

// Todos los ítems en paralelo — cada uno con su propio tope adentro de fetchPosterClient.
export async function fetchPostersClient(
  items: { title: string; type: string; year?: string }[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    items.map(async (it) => [it.title, await fetchPosterClient(it.title, it.type, it.year)] as const),
  );
  return Object.fromEntries(entries);
}
