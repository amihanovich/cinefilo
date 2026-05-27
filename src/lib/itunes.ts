// Client-side iTunes poster fetcher (called directly from the browser — no server hop)
// iTunes Search API supports CORS, so this avoids server IP throttling.

function upscale(url: string): string {
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, "/600x600bb.jpg");
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

async function searchOne(
  title: string,
  entity: "movie" | "tvShow",
  country: string,
): Promise<string | null> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=${entity}&limit=3&country=${country}&lang=es_ar`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const art = data.results?.[0]?.artworkUrl100;
    if (!art) return null;
    return upscale(art);
  } catch {
    return null;
  }
}

export async function fetchPosterClient(title: string, type: string): Promise<string | null> {
  const clean = normalizeTitle(title);
  const noArticle = stripArticle(clean);
  const entity: "movie" | "tvShow" = isSeries(type) ? "tvShow" : "movie";
  const alt: "movie" | "tvShow" = entity === "movie" ? "tvShow" : "movie";

  const [usMain, arMain, usAlt, arAlt] = await Promise.all([
    searchOne(clean, entity, "us"),
    searchOne(clean, entity, "ar"),
    searchOne(clean, alt, "us"),
    searchOne(clean, alt, "ar"),
  ]);

  const round1 = usMain ?? arMain ?? usAlt ?? arAlt;
  if (round1) return round1;

  if (noArticle !== clean) {
    const [usNo, arNo] = await Promise.all([
      searchOne(noArticle, entity, "us"),
      searchOne(noArticle, entity, "ar"),
    ]);
    return usNo ?? arNo ?? null;
  }

  return null;
}

export async function fetchPostersClient(
  items: { title: string; type: string }[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    items.map(async (it) => {
      const poster = await fetchPosterClient(it.title, it.type);
      return [it.title, poster] as const;
    }),
  );
  const result: Record<string, string | null> = {};
  for (const [t, p] of entries) result[t] = p;
  return result;
}
