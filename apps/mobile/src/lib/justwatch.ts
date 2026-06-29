// Cliente JustWatch GraphQL (API no oficial, ampliamente usada por apps de terceros).
// Devuelve deeplinks nativos (nflx://, disneyplus://, etc.) con el ID específico del contenido.

const JW_ENDPOINT = "https://apis.justwatch.com/graphql";

// technical name de JustWatch → nuestro nombre de plataforma
const JW_TO_PLATFORM: Record<string, string> = {
  nfx: "Netflix",
  amp: "Prime Video",
  prv: "Prime Video",
  dnp: "Disney+",
  max: "Max",
  hbm: "Max",
  atp: "Apple TV+",
  pmp: "Paramount+",
  stp: "Star+",
  sop: "Star+",
};

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

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

// Esquemas custom de las apps de streaming. Android los resuelve vía ACTION_VIEW
// (compatible con Capacitor) y abren la app nativa si está instalada.
// Solo incluimos los que tienen un scheme público confiable; el resto cae a la
// URL web (que en muchas apps está registrada como App Link y abre la app igual).
const ANDROID_SCHEME: Record<string, string> = {
  Netflix: "nflx://www.netflix.com/search?q=",
  "Disney+": "disneyplus://",
  "Star+": "disneyplus://",
};

// Abre el contenido en la app nativa si está instalada.
// Prioridad: deeplink nativo de JustWatch → scheme custom de la plataforma → web.
// Las URLs https de título suelen ser App Links y abren la app igual.
export function openInApp(platform: string, webUrl: string, title?: string): void {
  if (isAndroid()) {
    const scheme = ANDROID_SCHEME[platform];
    if (scheme) {
      const url = scheme.endsWith("=") && title ? scheme + encodeURIComponent(title) : scheme;
      window.open(url, "_system");
      return;
    }
  }
  // '_system' → ACTION_VIEW; si la app registró App Links para esta URL, abre la app
  window.open(webUrl, "_system");
}

export function openNative(result: JwResult): void {
  // Para títulos confirmados, JustWatch da la URL exacta del título. Esa URL
  // suele estar registrada como App Link y abre la app directo en ese título
  // (mejor que un scheme de búsqueda, que perdería el título exacto).
  if (isAndroid()) {
    // Deeplink nativo exacto de JustWatch (scheme custom → app, no http)
    if (result.deeplinkAndroid && !/^https?:/i.test(result.deeplinkAndroid)) {
      window.open(result.deeplinkAndroid, "_system");
      return;
    }
    if (result.standardWebURL) {
      window.open(result.standardWebURL, "_system");
      return;
    }
    return;
  }
  // iOS: los Universal Links abren la app desde la URL https
  const url = result.deeplinkIos ?? result.standardWebURL;
  if (url) window.open(url, "_system");
}

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

  const edges =
    (data as { data?: { popularTitles?: { edges?: { node?: {
      offers?: JwOffer[];
    } }[] } } })
    ?.data?.popularTitles?.edges ?? [];

  for (const edge of edges) {
    const offers: JwOffer[] = (edge?.node as { offers?: JwOffer[] })?.offers ?? [];
    // Filtrar solo streaming por suscripción (FLATRATE) en la plataforma pedida
    const match = offers.find(
      (o) =>
        o.monetizationType === "FLATRATE" &&
        wantedPackages.includes(o.package.technicalName),
    );
    if (match) {
      return {
        confirmed: true,
        standardWebURL: match.standardWebURL,
        deeplinkAndroid: match.deeplinkAndroid,
        deeplinkIos: match.deeplinkIos,
      };
    }
  }

  return { confirmed: false, standardWebURL: null, deeplinkAndroid: null, deeplinkIos: null };
}
