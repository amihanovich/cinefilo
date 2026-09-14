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

import { AppLauncher } from "@capacitor/app-launcher";

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

// Esquema custom de cada app de streaming para detectar/abrir la app nativa.
// `probe`: URL mínima para preguntar si la app está instalada (canOpenUrl).
// `open`: a dónde llevar dentro de la app (búsqueda del título si se puede).
// Para los packages sin scheme público confiable caemos a la URL web (App Link).
// OJO (verificado con adb en Android TV): el esquema NECESITA EL HOST —
// "disneyplus://search?q=X" NO resuelve, "disneyplus://www.disneyplus.com/search?q=X" sí.
// Antes Disney+/Star+ abrían la app en el home (open: () => "disneyplus://"), sin
// el título; ahora van directo a la búsqueda con el nombre puesto, igual que la TV.
type Scheme = { probe: string; open: (title: string) => string };
const SCHEMES: Record<string, Scheme> = {
  Netflix: { probe: "nflx://", open: (t) => `nflx://www.netflix.com/search?q=${encodeURIComponent(t)}` },
  "Disney+": { probe: "disneyplus://", open: (t) => `disneyplus://www.disneyplus.com/search?q=${encodeURIComponent(t)}` },
  // Star+ se fusionó con Disney+ (LatAm 2024): su contenido abre en Disney+.
  "Star+": { probe: "disneyplus://", open: (t) => `disneyplus://www.disneyplus.com/search?q=${encodeURIComponent(t)}` },
  Max: { probe: "hbomax://", open: (t) => `hbomax://play.max.com/search?q=${encodeURIComponent(t)}` },
  "Apple TV+": { probe: "videos://", open: (t) => `videos://tv.apple.com/search?term=${encodeURIComponent(t)}` },
};

async function launch(url: string): Promise<boolean> {
  try {
    await AppLauncher.openUrl({ url });
    return true;
  } catch {
    return false;
  }
}

async function appInstalled(probe: string): Promise<boolean> {
  try {
    const { value } = await AppLauncher.canOpenUrl({ url: probe });
    return value;
  } catch {
    return false;
  }
}

// Abre el contenido en la app nativa si está instalada; si no, la web.
// Usa @capacitor/app-launcher para detectar (canOpenUrl) y abrir (openUrl).
export async function openInApp(platform: string, webUrl: string, title?: string): Promise<void> {
  if (isAndroid()) {
    const s = SCHEMES[platform];
    if (s && title && (await appInstalled(s.probe))) {
      if (await launch(s.open(title))) return;
    }
  }
  // Fallback: '_system' → ACTION_VIEW; si la app registró App Links, abre la app igual
  window.open(webUrl, "_system");
}

// Devuelve true si logró abrir/lanzar algo; false si no tenía nada usable (para
// que el caller pueda caer a un fallback web y el botón nunca quede sin efecto).
export async function openNative(result: JwResult): Promise<boolean> {
  // Para títulos confirmados, JustWatch da la URL exacta del título. Esa URL
  // suele estar registrada como App Link y abre la app directo en ese título.
  if (isAndroid()) {
    // 1) Deeplink nativo exacto de JustWatch (scheme custom → app, no http)
    if (result.deeplinkAndroid && !/^https?:/i.test(result.deeplinkAndroid)) {
      if (await launch(result.deeplinkAndroid)) return true;
    }
    // 2) URL de título (App Link) → abre la app en ese título si está instalada
    if (result.standardWebURL) {
      if (await launch(result.standardWebURL)) return true;
      window.open(result.standardWebURL, "_system");
      return true;
    }
    return false;
  }
  // iOS: los Universal Links abren la app desde la URL https
  const url = result.deeplinkIos ?? result.standardWebURL;
  if (url) { window.open(url, "_system"); return true; }
  return false;
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
