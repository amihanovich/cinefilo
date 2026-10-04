// "Recién llegados": lo que ENTRÓ hace poco a cada plataforma en el país del
// usuario, aunque la película tenga años (una de 2022 que recién aterriza en
// Prime Argentina). Es la clave contra lo obvio: lo famoso del género que está
// en el catálogo hace años la persona ya lo vio; lo que acaba de llegar, no.
//
// Fuente: el feed "Nuevo" de JustWatch (GraphQL no oficial, la misma API que
// la app usa para los deep-links). TMDB no sabe cuándo entró un título a una
// plataforma. Módulo Node autónomo; lo usa recommend.mjs. Si JustWatch falla,
// la lista queda vacía o con lo último que había: la recomendación nunca se
// rompe por esto.

import { fetchUpstream } from "./upstream.mjs";
import { DEFAULT_REGION } from "./availability.mjs";

const JW_URL = process.env.JUSTWATCH_GRAPHQL_URL || "https://apis.justwatch.com/graphql";
const WINDOW_DAYS = 90;
const MAX_PAGES_PER_DAY = 8; // 100 por página; un día pesado anda por 600
const CONCURRENCY = 4;
const REFRESH_MS = 12 * 60 * 60 * 1000;
// Los días viejos ya no cambian; hoy y ayer siguen sumando títulos.
const DAY_TTL_OLD_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_TTL_RECENT_MS = 6 * 60 * 60 * 1000;

// Paquetes de JustWatch → nuestras 7 plataformas. Los canales dentro de Prime /
// Apple cuentan como la plataforma (igual que "Universal+ Amazon Channel").
const PACKAGE_TO_PLATFORM = {
  netflix: "Netflix",
  disneyplus: "Disney+",
  max: "Max",
  hbomax: "Max",
  amazonprimevideo: "Prime Video",
  appletvplus: "Apple TV+",
  paramountplus: "Paramount+",
  amazonparamountplus: "Paramount+",
  appletvparamountplus: "Paramount+",
  amazonuniversalplus: "Universal+",
  universalplus: "Universal+",
};
function platformOf(pkg) {
  if (!pkg) return null;
  return PACKAGE_TO_PLATFORM[pkg.technicalName] || (/universal\s*(\+|plus)/i.test(pkg.clearName || "") ? "Universal+" : null);
}

const GENRES = {
  act: "acción", ani: "animación", cmy: "comedia", crm: "crimen", doc: "documental", drm: "drama",
  fml: "familiar", fnt: "fantasía", hst: "histórica", hrr: "terror", msc: "música", rma: "romance",
  scf: "ciencia ficción", spt: "deporte", trl: "thriller", war: "bélica", wsn: "western", rly: "reality",
};

const QUERY = `query MiruNew($country: Country!, $date: Date!, $language: Language!, $first: Int!, $after: String) {
  newTitles(country: $country, date: $date, first: $first, after: $after, pageType: NEW, filter: { objectTypes: [MOVIE, SHOW] }) {
    pageInfo { hasNextPage endCursor }
    edges {
      newOffer(platform: WEB) { monetizationType package { technicalName clearName } }
      node {
        __typename
        ... on Movie { content(country: $country, language: $language) { title originalTitle originalReleaseYear productionCountries genres { shortName } scoring { imdbScore imdbVotes tmdbPopularity } } }
        ... on Season {
          content(country: $country, language: $language) { seasonNumber }
          show { content(country: $country, language: $language) { title originalTitle originalReleaseYear productionCountries genres { shortName } scoring { imdbScore imdbVotes tmdbPopularity } } }
        }
      }
    }
  }
}`;

const dayCache = new Map(); // `${country}|${date}` → { at, items }
const snapshots = new Map(); // country → { at, items, refreshing }

const isoDay = (d) => d.toISOString().slice(0, 10);

async function fetchDay(country, date) {
  const key = `${country}|${date}`;
  const hit = dayCache.get(key);
  const ageLimit = Date.now() - new Date(date).getTime() > 2 * 86400000 ? DAY_TTL_OLD_MS : DAY_TTL_RECENT_MS;
  if (hit && Date.now() - hit.at < ageLimit) return hit.items;
  const items = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES_PER_DAY; page++) {
    const res = await fetchUpstream(JW_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { country, language: "es", date, first: 100, after } }),
    }, { timeoutMs: 15000 });
    if (!res.ok) throw new Error("JustWatch HTTP " + res.status);
    const json = await res.json();
    if (json.errors && !json.data) throw new Error("JustWatch: " + String(json.errors[0] && json.errors[0].message).slice(0, 120));
    const block = json.data && json.data.newTitles;
    if (!block) break;
    for (const e of block.edges || []) {
      const offer = e.newOffer;
      if (!offer || !["FLATRATE", "ADS", "FREE"].includes(offer.monetizationType)) continue;
      const platform = platformOf(offer.package);
      if (!platform) continue;
      const node = e.node || {};
      const isShow = node.__typename === "Season";
      const c = isShow ? node.show && node.show.content : node.content;
      if (!c || !c.title) continue;
      items.push({
        title: c.title,
        originalTitle: c.originalTitle || null,
        year: c.originalReleaseYear ? String(c.originalReleaseYear) : undefined,
        type: isShow ? "Serie" : "Película",
        season: isShow && node.content ? node.content.seasonNumber || null : null,
        platform,
        addedAt: date,
        genres: (c.genres || []).map((g) => GENRES[g.shortName]).filter(Boolean),
        imdb: c.scoring && typeof c.scoring.imdbScore === "number" ? c.scoring.imdbScore : null,
        votes: c.scoring && typeof c.scoring.imdbVotes === "number" ? c.scoring.imdbVotes : null,
        popularity: c.scoring && typeof c.scoring.tmdbPopularity === "number" ? c.scoring.tmdbPopularity : null,
        countries: Array.isArray(c.productionCountries) ? c.productionCountries : [],
      });
    }
    if (!block.pageInfo || !block.pageInfo.hasNextPage) break;
    after = block.pageInfo.endCursor;
  }
  dayCache.set(key, { at: Date.now(), items });
  return items;
}

async function refresh(country) {
  const days = [];
  for (let i = 0; i < WINDOW_DAYS; i++) days.push(isoDay(new Date(Date.now() - i * 86400000)));
  const byDay = new Map();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < days.length) {
      const d = days[next++];
      try { byDay.set(d, await fetchDay(country, d)); } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // Más reciente primero; un título que llegó a dos plataformas queda una vez
  // por plataforma, y una serie una vez (la temporada más nueva).
  const seen = new Set();
  const items = [];
  for (const d of days) {
    for (const it of byDay.get(d) || []) {
      const k = `${norm(it.title)}|${it.platform}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }
  }
  return { items, failed };
}

/** Dispara (o reusa) la actualización del país. No espera. */
export function warmFresh(country = DEFAULT_REGION) {
  const c = String(country || DEFAULT_REGION).toUpperCase();
  const snap = snapshots.get(c) || { at: 0, items: [], refreshing: null };
  snapshots.set(c, snap);
  if (snap.refreshing || Date.now() - snap.at < REFRESH_MS) return snap.refreshing || Promise.resolve();
  const t0 = Date.now();
  snap.refreshing = refresh(c)
    .then(({ items, failed }) => {
      // Si JustWatch se cayó entera, conservar lo anterior.
      if (items.length || !snap.items.length) { snap.items = items; snap.at = Date.now(); }
      console.log(`[fresh] ${c}: ${items.length} recién llegados en ${WINDOW_DAYS} días (${failed} días fallidos, ${Date.now() - t0} ms)`);
    })
    .catch((e) => console.warn(`[fresh] ${c}: falló la actualización:`, e.message))
    .finally(() => { snap.refreshing = null; });
  return snap.refreshing;
}

export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Géneros que se leen en el pedido ("una histórica, medieval") → los de JustWatch.
const GENRE_WORDS = [
  [/\b(acci[oó]n|pi[nñ]as|tiros)\b/, "acción"],
  [/\b(comedia|re[ií]r|graciosa|divertida)\b/, "comedia"],
  [/\b(terror|miedo|horror|susto)\b/, "terror"],
  [/\b(drama|dram[aá]tica)\b/, "drama"],
  [/\b(rom[aá]ntica|romance|amor)\b/, "romance"],
  [/\b(thriller|suspenso|suspense|tensi[oó]n)\b/, "thriller"],
  [/\b(ciencia ficci[oó]n|sci-?fi|espacio|futurista)\b/, "ciencia ficción"],
  [/\b(hist[oó]ric[ao]s?|[eé]poca|medieval(es)?|edad media|imperio|romanos?|reyes|reinas?)\b/, "histórica"],
  [/\b(guerra|b[eé]lica)\b/, "bélica"],
  [/\b(documental(es)?)\b/, "documental"],
  [/\b(animad[ao]s?|animaci[oó]n|dibujos)\b/, "animación"],
  [/\b(fantas[ií]a|fant[aá]stic[ao])\b/, "fantasía"],
  [/\b(policial(es)?|crimen|mafia|g[aá]ngsters?)\b/, "crimen"],
  [/\b(western|vaqueros?)\b/, "western"],
  [/\b(musical(es)?)\b/, "música"],
];
function genresIn(text) {
  const t = String(text || "").toLowerCase();
  return GENRE_WORDS.filter(([re]) => re.test(t)).map(([, g]) => g);
}

/**
 * Lo que entró hace poco a las plataformas pedidas, del tipo pedido, sin lo
 * excluido. Nunca espera a JustWatch: devuelve lo que haya y refresca atrás.
 * Con `query` (el pedido), si nombra géneros se queda con esos; el orden
 * castiga lo archiconocido (lo que todos vieron) para que no tape lo demás.
 */
export function freshArrivals({ country, platforms = null, type = null, exclude = [], query = "", limit = 50 } = {}) {
  const c = String(country || DEFAULT_REGION).toUpperCase();
  void warmFresh(c);
  const snap = snapshots.get(c);
  if (!snap || !snap.items.length) return [];
  const plats = platforms && platforms.length ? new Set(platforms) : null;
  const ex = new Set((exclude || []).map(norm));
  const now = Date.now();
  const recentBase = snap.items
    .filter((it) => (!plats || plats.has(it.platform)) && (!type || it.type === type))
    .filter((it) => !ex.has(norm(it.title)) && !(it.originalTitle && ex.has(norm(it.originalTitle))))
    // Lo flojo no suma: sin puntaje o con poco consenso queda afuera.
    .filter((it) => it.imdb !== null && it.imdb >= 6 && (it.votes === null || it.votes >= 5000))
    // Las plataformas rotan clásicos: que Interstellar "vuelva" a Prime no la
    // hace un descubrimiento. Lo archiconocido no entra como recién llegado.
    .filter((it) => it.votes === null || it.votes < 400000)
    .map((it) => ({ ...it, days: Math.max(0, Math.round((now - new Date(it.addedAt).getTime()) / 86400000)) }));
  // Que una de 1957 "llegue" a Prime no la vuelve una buena sorpresa: salvo
  // que pida algo viejo, los recién llegados son de los últimos 20 años.
  const wantsOld = /\b(cl[aá]sic[ao]s?|viej[ao]s?|antigu[ao]s?|de los (40|50|60|70|80|90)|a[nñ]os (40|50|60|70|80|90)|blanco y negro)\b/i.test(String(query || ""));
  const minYear = new Date().getFullYear() - 20;
  const base = wantsOld ? recentBase : recentBase.filter((it) => !it.year || Number(it.year) >= minYear);
  const wanted = genresIn(query);
  let pool = base;
  if (wanted.length) {
    // "histórica" en JustWatch a veces viene como bélica o drama de época: ambas cuentan.
    const accept = new Set(wanted.includes("histórica") ? [...wanted, "bélica"] : wanted);
    const byGenre = base.filter((it) => it.genres.some((g) => accept.has(g)));
    if (byGenre.length >= 5) pool = byGenre;
  }
  // El catálogo indio regional de Prime/Netflix trae puntajes inflados y rara
  // vez es "el peliculón" para alguien de acá: afuera, salvo que lo pida.
  if (!/\b(india|indi[ao]s?|bollywood|hindi|tamil|telugu)\b/i.test(String(query || ""))) {
    pool = pool.filter((it) => !(it.countries.length && it.countries.every((c) => c === "IN")));
  }
  const fame = (v) => (v === null ? 0 : v > 800000 ? 1.2 : v > 300000 ? 0.6 : v > 120000 ? 0.25 : 0);
  // La sorpresa de verdad: producción de los últimos años, que tuvo repercusión
  // afuera y recién ahora llega acá.
  const buzz = (it) => (it.votes ? Math.min(0.9, Math.log10(Math.max(1, it.votes)) * 0.18) : 0);
  const score = (it) => it.imdb - fame(it.votes) + buzz(it) + (isRecent(it) ? 1.2 : 0) + (it.days <= 30 ? 0.2 : 0);
  // Un título que llegó a dos plataformas va una sola vez (la más reciente).
  const once = new Set();
  return pool
    .sort((a, b) => score(b) - score(a))
    .filter((it) => { const k = norm(it.title); if (once.has(k)) return false; once.add(k); return true; })
    .slice(0, limit);
}

/** Producida en los últimos años (la sorpresa que Miru busca). */
export const RECENT_YEARS = 4;
export function isRecent(it) {
  return !!it && !!it.year && Number(it.year) >= new Date().getFullYear() - RECENT_YEARS;
}

/** Busca un candidato del modelo en la lista (por título en español u original). */
export function matchFresh(list, title) {
  const n = norm(title);
  if (!n) return null;
  return list.find((it) => norm(it.title) === n || (it.originalTitle && norm(it.originalTitle) === n)) || null;
}

/** El bloque para el prompt del paso 1. */
export function freshBlock(list, country) {
  if (!list.length) return null;
  const lines = list.map((it) =>
    `- ${it.title}${it.originalTitle && norm(it.originalTitle) !== norm(it.title) ? ` / ${it.originalTitle}` : ""} (${it.year || "s/f"}, ${it.type}${it.season && it.season > 1 ? `, temporada ${it.season} nueva` : ""}) · ${it.platform} · ${it.genres.slice(0, 3).join(", ") || "-"} · IMDb ${it.imdb} · llegó hace ${it.days} días${isRecent(it) ? " · PRODUCCIÓN RECIENTE" : ""}`);
  return `Recién llegados a sus plataformas en ${country || DEFAULT_REGION} (últimos ${WINDOW_DAYS} días; confirmados en su catálogo, aunque la película tenga años):\n${lines.join("\n")}`;
}
