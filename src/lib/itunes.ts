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
      signal: AbortSignal.timeout(5000),
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
  // Try several search terms: "{title} film", "{title} {year}", "{title}"
  const queries: string[] = [`${title} film`];
  if (year) queries.push(`${title} ${year}`);
  queries.push(title);

  for (const q of queries) {
    try {
      const url =
        `https://en.wikipedia.org/w/api.php?action=query` +
        `&titles=${encodeURIComponent(q)}` +
        `&prop=pageimages&pithumbsize=600&format=json&origin=*`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data?.query?.pages ?? {};
      type WikiPage = { missing?: string; thumbnail?: { source?: string } };
      const page = Object.values(pages)[0] as WikiPage | undefined;
      if (!page || "missing" in page) continue;
      if (page.thumbnail?.source) return page.thumbnail.source;
    } catch {
      continue;
    }
  }

  // Try Spanish Wikipedia as a second source
  try {
    const url =
      `https://es.wikipedia.org/w/api.php?action=query` +
      `&titles=${encodeURIComponent(title)}` +
      `&prop=pageimages&pithumbsize=600&format=json&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const pages = data?.query?.pages ?? {};
      type WikiPage = { missing?: string; thumbnail?: { source?: string } };
      const page = Object.values(pages)[0] as WikiPage | undefined;
      if (page && !("missing" in page) && page.thumbnail?.source) {
        return page.thumbnail.source;
      }
    }
  } catch {
    // ignore
  }

  return null;
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

  // Round 1: primary media, US + AR
  const [usMain, arMain] = await Promise.all([
    searchItunes(clean, media, "us"),
    searchItunes(clean, media, "ar"),
  ]);
  if (usMain ?? arMain) return usMain ?? arMain;

  // Round 2: alternate media + strip article + ES/MX stores
  const [usAlt, arAlt, usNo, esMain, mxMain] = await Promise.all([
    searchItunes(clean, altMedia, "us"),
    searchItunes(clean, altMedia, "ar"),
    noArticle !== clean ? searchItunes(noArticle, media, "us") : Promise.resolve(null),
    searchItunes(clean, media, "es"),
    searchItunes(clean, media, "mx"),
  ]);
  const itunesResult = usAlt ?? arAlt ?? usNo ?? esMain ?? mxMain ?? null;
  if (itunesResult) return itunesResult;

  // Round 3: Wikipedia fallback (covers classics, arthouse, foreign films)
  return searchWikipedia(clean, year);
}

export async function fetchPostersClient(
  items: { title: string; type: string; year?: string }[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  // Process in batches of 3 to balance speed vs. rate limits
  const BATCH = 3;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const posters = await Promise.all(
      batch.map((it) => fetchPosterClient(it.title, it.type, it.year)),
    );
    batch.forEach((it, idx) => {
      result[it.title] = posters[idx];
    });
    if (i + BATCH < items.length) {
      await new Promise<void>((r) => setTimeout(r, 200));
    }
  }
  return result;
}
