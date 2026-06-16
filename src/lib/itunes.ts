// Client-side poster fetcher: iTunes first, Wikipedia fallback.
// Both APIs support CORS — no server hop needed.

function upscale(url: string): string {
  // iTunes artwork URLs support square sizes reliably; 600x600bb covers movies and series.
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
    const data = await res.json();
    const results: Array<{ artworkUrl100?: string; trackName?: string; collectionName?: string }> =
      data.results ?? [];
    if (results.length === 0) return null;

    let best = results[0];
    let bestScore = -1;
    for (const r of results) {
      const name = r.trackName ?? r.collectionName ?? "";
      const score = titleScore(name, title);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    const art = best.artworkUrl100;
    if (!art) return null;
    return upscale(art);
  } catch {
    return null;
  }
}

async function searchWikipedia(title: string, year?: string): Promise<string | null> {
  // Try "{title} film" then "{title} year" in parallel, take first hit
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
      const data = await res.json();
      const pages = data?.query?.pages ?? {};
      type WikiPage = { missing?: string; thumbnail?: { source?: string } };
      const page = Object.values(pages)[0] as WikiPage | undefined;
      if (!page || "missing" in page) return null;
      return page.thumbnail?.source ?? null;
    } catch {
      return null;
    }
  };

  // Run all wikipedia queries in parallel, return first non-null
  const results = await Promise.all([
    ...queries.map((q) => tryQuery(q, "en")),
    tryQuery(title, "es"),
  ]);
  return results.find(Boolean) ?? null;
}

export async function fetchPosterClient(
  title: string,
  type: string,
  year?: string,
): Promise<string | null> {
  const clean = normalizeTitle(title);
  const noArticle = stripArticle(clean);
  const media: "movie" | "tvShow" = isSeries(type) ? "tvShow" : "movie";
  const altMedia: "movie" | "tvShow" = media === "movie" ? "tvShow" : "movie";

  // Hard cap: give up after 5s total regardless of what's still in flight
  const deadline = new Promise<null>((r) => setTimeout(() => r(null), 5000));

  const search = async (): Promise<string | null> => {
    // Round 1: primary media US + AR in parallel
    const [usMain, arMain] = await Promise.all([
      searchItunes(clean, media, "us"),
      searchItunes(clean, media, "ar"),
    ]);
    if (usMain ?? arMain) return usMain ?? arMain;

    // Round 2: alt media + no-article + ES store, all in parallel
    const [usAlt, arAlt, usNo, esMain] = await Promise.all([
      searchItunes(clean, altMedia, "us"),
      searchItunes(clean, altMedia, "ar"),
      noArticle !== clean ? searchItunes(noArticle, media, "us") : Promise.resolve(null),
      searchItunes(clean, media, "es"),
    ]);
    const itunesResult = usAlt ?? arAlt ?? usNo ?? esMain ?? null;
    if (itunesResult) return itunesResult;

    // Round 3: Wikipedia fallback
    return searchWikipedia(clean, year);
  };

  return Promise.race([search(), deadline]);
}

// All items in parallel — each has its own 5s cap inside fetchPosterClient
export async function fetchPostersClient(
  items: { title: string; type: string; year?: string }[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    items.map(async (it) => [it.title, await fetchPosterClient(it.title, it.type, it.year)] as const),
  );
  return Object.fromEntries(entries);
}
