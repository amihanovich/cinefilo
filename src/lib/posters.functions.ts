import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        type: z.string().min(1).max(40),
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
    .replace(/\s*\([^)]*\)\s*$/, "")           // remove trailing (...)
    .replace(/:\s*(temporada|season|capítulo|chapter)\s*\d+.*/i, "")
    .replace(/,?\s*(temporada|season)\s*\d+.*/i, "")
    .replace(/\s*[-–]\s*(temporada|season)\s*\d+.*/i, "")
    .trim();
}

async function searchOne(
  title: string,
  entity: "movie" | "tvShow",
  country: string,
): Promise<string | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    title,
  )}&entity=${entity}&limit=1&country=${country}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; QueVeo/1.0)",
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[posters] iTunes ${country}/${entity} "${title}" → HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as ITunesResponse;
    const art = data.results?.[0]?.artworkUrl100;
    if (art) {
      const upscaled = upscale(art);
      console.log(`[posters] ✓ "${title}" → ${upscaled}`);
      return upscaled;
    }
    console.log(`[posters] ✗ "${title}" (${country}/${entity}) no results`);
    return null;
  } catch (e) {
    clearTimeout(timer);
    console.warn(`[posters] fetch error "${title}" (${country}/${entity}):`, e);
    return null;
  }
}

async function fetchPosterForTitle(title: string, type: string): Promise<string | null> {
  const clean = normalizeTitle(title);
  const entity: "movie" | "tvShow" = isSeries(type) ? "tvShow" : "movie";
  const alt: "movie" | "tvShow" = entity === "movie" ? "tvShow" : "movie";

  const [usMain, arMain, usAlt] = await Promise.all([
    searchOne(clean, entity, "us"),
    searchOne(clean, entity, "ar"),
    searchOne(clean, alt, "us"),
  ]);
  return usMain ?? arMain ?? usAlt ?? null;
}

export const fetchPosters = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const entries = await Promise.all(
      data.items.map(async (it) => {
        const poster = await fetchPosterForTitle(it.title, it.type);
        return [it.title, poster] as const;
      }),
    );
    const posters: Record<string, string | null> = {};
    for (const [t, p] of entries) posters[t] = p;
    return { posters };
  });
