// Client-side iTunes poster fetcher (called directly from the browser — no server hop)
// iTunes Search API supports CORS, so this avoids server IP throttling.

function upscale(url: string): string {
  // Replace any size suffix like /100x100bb.jpg or /500x750bb.jpg with /600x900bb.jpg
  return url.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, "/600x900bb.$1");
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

async function searchOne(
  title: string,
  media: "movie" | "tvShow",
  country: string,
): Promise<string | null> {
  try {
    const entity = media === "movie" ? "movie" : "tvSeason";
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=${media}&entity=${entity}&limit=5&country=${country}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const results: Array<{ artworkUrl100?: string; trackName?: string; collectionName?: string }> =
      data.results ?? [];
    if (results.length === 0) return null;

    // Pick the result that best matches the title
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

export async function fetchPosterClient(title: string, type: string): Promise<string | null> {
  const clean = normalizeTitle(title);
  const noArticle = stripArticle(clean);
  const media: "movie" | "tvShow" = isSeries(type) ? "tvShow" : "movie";
  const altMedia: "movie" | "tvShow" = media === "movie" ? "tvShow" : "movie";

  // First round: primary media type, US + AR
  const [usMain, arMain] = await Promise.all([
    searchOne(clean, media, "us"),
    searchOne(clean, media, "ar"),
  ]);
  if (usMain ?? arMain) return usMain ?? arMain;

  // Second round: alternate media type + strip article
  const [usAlt, arAlt, usNo, arNo] = await Promise.all([
    searchOne(clean, altMedia, "us"),
    searchOne(clean, altMedia, "ar"),
    noArticle !== clean ? searchOne(noArticle, media, "us") : Promise.resolve(null),
    noArticle !== clean ? searchOne(noArticle, media, "ar") : Promise.resolve(null),
  ]);

  return usAlt ?? arAlt ?? usNo ?? arNo ?? null;
}

export async function fetchPostersClient(
  items: { title: string; type: string }[],
): Promise<Record<string, string | null>> {
  // Sequential with small delay to avoid iTunes rate-limiting
  const result: Record<string, string | null> = {};
  for (const it of items) {
    result[it.title] = await fetchPosterClient(it.title, it.type);
    await new Promise<void>((r) => setTimeout(r, 120));
  }
  return result;
}
