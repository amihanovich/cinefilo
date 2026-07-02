// Adaptado de apps/mobile/src/lib/justwatch.ts — se mantiene jwSearch
// (búsqueda de disponibilidad) verbatim. openNative/openInApp del móvil NO se
// portan: el lanzamiento en TV usa packages/schemes distintos y vive en
// ./tv-launcher.ts.

const JW_ENDPOINT = "https://apis.justwatch.com/graphql";

// Nuestro nombre de plataforma → technical names de JustWatch
const PLATFORM_TO_JW: Record<string, string[]> = {
  Netflix: ["nfx"],
  "Prime Video": ["amp", "prv"],
  "Disney+": ["dnp"],
  Max: ["max", "hbm"],
  "Apple TV+": ["atp"],
  "Paramount+": ["pmp"],
  "Star+": ["stp", "sop", "dnp"],
};

const QUERY = `
query GetTitleOffers(
  $searchQuery: String!
  $country: Country!
  $language: Language!
  $objectTypes: [ObjectType!]
) {
  popularTitles(
    country: $country
    first: 5
    filter: { searchQuery: $searchQuery, objectTypes: $objectTypes }
  ) {
    edges {
      node {
        objectType
        ... on Movie {
          content(country: $country, language: $language) { title }
          offers(country: $country, platform: WEB) {
            monetizationType
            standardWebURL
            deeplinkAndroid
            deeplinkIos
            package { technicalName clearName }
          }
        }
        ... on Show {
          content(country: $country, language: $language) { title }
          offers(country: $country, platform: WEB) {
            monetizationType
            standardWebURL
            deeplinkAndroid
            deeplinkIos
            package { technicalName clearName }
          }
        }
      }
    }
  }
}
`;

export type JwOffer = {
  standardWebURL: string;
  deeplinkAndroid: string | null;
  deeplinkIos: string | null;
  package: { technicalName: string; clearName: string };
  monetizationType: string;
};

export type JwResult = {
  confirmed: boolean;
  standardWebURL: string | null;
  deeplinkAndroid: string | null;
  deeplinkIos: string | null;
};

export async function jwSearch(
  title: string,
  platform: string,
  type: string,
  country: string,
): Promise<JwResult> {
  const objectTypes = type === "Serie" ? ["SHOW"] : ["MOVIE"];
  const wantedPackages = PLATFORM_TO_JW[platform] ?? [];

  let data: unknown;
  try {
    const res = await fetch(JW_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "App-Version": "3.8.2",
      },
      body: JSON.stringify({
        operationName: "GetTitleOffers",
        query: QUERY,
        variables: {
          searchQuery: title,
          country,
          language: "es",
          objectTypes,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`JW HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.warn("[justwatch] error:", e);
    return { confirmed: false, standardWebURL: null, deeplinkAndroid: null, deeplinkIos: null };
  }

  type JwNode = { content?: { title?: string }; offers?: JwOffer[] };
  const edges =
    (data as { data?: { popularTitles?: { edges?: { node?: JwNode }[] } } })
    ?.data?.popularTitles?.edges ?? [];

  // IMPORTANTE: la búsqueda de JustWatch devuelve varios títulos "populares" que
  // matchean el texto — el primero puede ser OTRA película. Scoreamos el título
  // de cada resultado contra el pedido y solo confirmamos si realmente coincide.
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const scoreTitle = (result: string, expected: string): number => {
    const r = norm(result);
    const e = norm(expected);
    if (!r || !e) return 0;
    if (r === e) return 3;
    if (r.startsWith(e) || e.startsWith(r)) return 2;
    if (r.includes(e) || e.includes(r)) return 1;
    return 0;
  };

  let best: { score: number; offer: JwOffer } | null = null;
  for (const edge of edges) {
    const node = edge?.node;
    if (!node) continue;
    const offers: JwOffer[] = node.offers ?? [];
    // Solo streaming por suscripción (FLATRATE) en la plataforma pedida
    const match = offers.find(
      (o) =>
        o.monetizationType === "FLATRATE" &&
        wantedPackages.includes(o.package.technicalName),
    );
    if (!match) continue;

    const score = scoreTitle(node.content?.title ?? "", title);
    if (score === 0) continue; // título distinto → no es lo que buscamos
    if (!best || score > best.score) best = { score, offer: match };
    if (best.score === 3) break; // match exacto, no hace falta seguir
  }

  if (best) {
    return {
      confirmed: true,
      standardWebURL: best.offer.standardWebURL,
      deeplinkAndroid: best.offer.deeplinkAndroid,
      deeplinkIos: best.offer.deeplinkIos,
    };
  }

  return { confirmed: false, standardWebURL: null, deeplinkAndroid: null, deeplinkIos: null };
}
