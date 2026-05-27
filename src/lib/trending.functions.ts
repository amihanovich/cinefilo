import { createServerFn } from "@tanstack/react-start";

export type TrendingTitle = {
  id: string;
  title: string;
  type: "movie" | "show";
  platform: string;
  posterUrl: string | null;
  year: number | null;
};

let _cache: { data: TrendingTitle[]; ts: number } | null = null;
const TTL = 60 * 60_000; // 1h

const GQL = `
query GetPopularTitles($country: Country!, $language: Language!, $first: Int) {
  popularTitles(country: $country, first: $first) {
    edges {
      node {
        ... on Movie {
          id objectType
          content(country: $country, language: $language) {
            title posterUrl originalReleaseYear
          }
          offers(country: $country, platform: WEB) {
            package { clearName }
          }
        }
        ... on Show {
          id objectType
          content(country: $country, language: $language) {
            title posterUrl originalReleaseYear
          }
          offers(country: $country, platform: WEB) {
            package { clearName }
          }
        }
      }
    }
  }
}
`;

function buildPosterUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url = raw.startsWith("http") ? raw : `https://images.justwatch.com${raw}`;
  // upscale: replace size suffix like /s166 or /s332 with /s592
  url = url.replace(/\/s\d+(\/)?$/, "/s592");
  return url;
}

async function loadTrending(): Promise<TrendingTitle[]> {
  if (_cache && Date.now() - _cache.ts < TTL) return _cache.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const res = await fetch("https://apis.justwatch.com/graphql", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; QueVeo/1.0)",
        "App-Version": "3.8.2-web",
      },
      body: JSON.stringify({
        operationName: "GetPopularTitles",
        variables: { country: "AR", language: "es", first: 12 },
        query: GQL,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn("[trending] JustWatch HTTP", res.status);
      return _cache?.data ?? [];
    }

    const json = (await res.json()) as any;
    const edges: any[] = json?.data?.popularTitles?.edges ?? [];

    const titles: TrendingTitle[] = edges.flatMap((e: any) => {
      const n = e?.node;
      if (!n) return [];
      const c = n.content;
      if (!c?.title) return [];
      const offer = (n.offers ?? []).find((o: any) => o?.package?.clearName);
      if (!offer) return [];
      return [{
        id: String(n.id ?? Math.random()),
        title: c.title,
        type: n.objectType === "SHOW" ? "show" : "movie",
        platform: offer.package.clearName,
        posterUrl: buildPosterUrl(c.posterUrl),
        year: c.originalReleaseYear ?? null,
      }];
    });

    if (titles.length) _cache = { data: titles, ts: Date.now() };
    console.log(`[trending] loaded ${titles.length} titles from JustWatch`);
    return titles;
  } catch (e) {
    clearTimeout(timer);
    console.warn("[trending] error:", e);
    return _cache?.data ?? [];
  }
}

export const getTrending = createServerFn({ method: "GET" }).handler(async () => {
  const titles = await loadTrending();
  return { titles };
});
