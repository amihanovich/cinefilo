import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        type: z.string().min(1).max(40),
        year: z.string().max(10).optional(),
      }),
    )
    .min(1)
    .max(6),
});

type ITunesResult = {
  artworkUrl100?: string;
  trackName?: string;
  collectionName?: string;
};
type ITunesResponse = { results?: ITunesResult[] };

function upscale(url: string): string {
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, "/600x600bb.jpg");
}

function isSeries(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("serie") || t.includes("capítulo") || t.includes("capitulo");
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

async function searchItunes(
  title: string,
  entity: "movie" | "tvShow",
  country: string,
): Promise<string | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=${entity}&limit=5&country=${country}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; Cinefilo/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as ITunesResponse;
    const results = data.results ?? [];
    if (results.length === 0) return null;

    // Pick best title match
    const tl = title.toLowerCase();
    const best = results.reduce((a, b) => {
      const aName = (a.trackName ?? a.collectionName ?? "").toLowerCase();
      const bName = (b.trackName ?? b.collectionName ?? "").toLowerCase();
      const aScore = aName === tl ? 2 : aName.includes(tl) || tl.includes(aName) ? 1 : 0;
      const bScore = bName === tl ? 2 : bName.includes(tl) || tl.includes(bName) ? 1 : 0;
      return bScore > aScore ? b : a;
    });
    return best.artworkUrl100 ? upscale(best.artworkUrl100) : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function searchWikipedia(title: string, year?: string): Promise<string | null> {
  const queries = [`${title} film`, title];
  if (year) queries.splice(1, 0, `${title} ${year}`);

  const tryQuery = async (q: string, lang = "en"): Promise<string | null> => {
    const url =
      `https://${lang}.wikipedia.org/w/api.php?action=query` +
      `&titles=${encodeURIComponent(q)}&prop=pageimages&pithumbsize=600&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      const pages = data?.query?.pages ?? {};
      type WikiPage = { missing?: string; thumbnail?: { source?: string } };
      const page = Object.values(pages)[0] as WikiPage | undefined;
      if (!page || "missing" in page) return null;
      return page.thumbnail?.source ?? null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  const results = await Promise.all([
    ...queries.map((q) => tryQuery(q, "en")),
    tryQuery(title, "es"),
  ]);
  return results.find(Boolean) ?? null;
}

async function fetchPosterForTitle(title: string, type: string, year?: string): Promise<string | null> {
  const clean = normalizeTitle(title);
  const noArticle = stripArticle(clean);
  const entity: "movie" | "tvShow" = isSeries(type) ? "tvShow" : "movie";
  const alt: "movie" | "tvShow" = entity === "movie" ? "tvShow" : "movie";

  // Round 1: all iTunes combos in parallel
  const [usMain, arMain, usAlt, arAlt, esMain] = await Promise.all([
    searchItunes(clean, entity, "us"),
    searchItunes(clean, entity, "ar"),
    searchItunes(clean, alt, "us"),
    searchItunes(clean, alt, "ar"),
    searchItunes(clean, entity, "es"),
  ]);
  const r1 = usMain ?? arMain ?? usAlt ?? arAlt ?? esMain;
  if (r1) return r1;

  // Round 2: strip article
  if (noArticle !== clean) {
    const [usNo, arNo] = await Promise.all([
      searchItunes(noArticle, entity, "us"),
      searchItunes(noArticle, alt, "us"),
    ]);
    if (usNo ?? arNo) return usNo ?? arNo;
  }

  // Round 3: Wikipedia fallback
  return searchWikipedia(clean, year);
}

export const fetchPosters = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const entries = await Promise.all(
      data.items.map(async (it) => {
        const poster = await fetchPosterForTitle(it.title, it.type, it.year);
        return [it.title, poster] as const;
      }),
    );
    const posters: Record<string, string | null> = {};
    for (const [t, p] of entries) posters[t] = p;
    return { posters };
  });
