import { fetchUpstream } from "./upstream.mjs";

// Disponibilidad REAL por territorio, vía TMDB (datos de watch providers de
// JustWatch — atribución requerida en la UI). Módulo Node autónomo, mismo
// estilo que tv-search.mjs / upstream.mjs.
//
// Rol: Haiku sigue siendo el curador (gusto, porqué); esto es la fuente de
// verdad de "dónde se ve". Después de que el LLM genera, validateItems()
// confirma la plataforma dicha, la corrige si el título está en OTRA
// plataforma del usuario, o lo marca para descartar si no está en ninguna.
//
// Sin TMDB_API_KEY todo es no-op (los ítems pasan tal cual): deployar sin la
// clave no rompe nada, solo se pierde la validación.

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

export const DEFAULT_REGION = (process.env.DEFAULT_REGION || "AR").toUpperCase();

export function availabilityEnabled() {
  return Boolean(process.env.TMDB_API_KEY);
}

// Mapeo TMDB → nombre canónico de plataforma del producto. Se matchea por
// provider_id Y por nombre (robusto a rebrands tipo Max↔HBO Max; las variantes
// "with Ads" / "Amazon Channel" cuentan como la plataforma madre).
const PROVIDER_MAP = [
  { canonical: "Netflix", ids: [8, 1796], re: /netflix/i },
  { canonical: "Prime Video", ids: [119, 9, 613], re: /amazon prime|prime video/i },
  { canonical: "Disney+", ids: [337], re: /disney/i },
  { canonical: "Max", ids: [1899, 384, 616], re: /^max\b|hbo/i },
  { canonical: "Apple TV+", ids: [350], re: /apple tv\+|apple tv plus/i },
  { canonical: "Paramount+", ids: [531, 582], re: /paramount/i },
];

function canonicalProvider(p) {
  for (const m of PROVIDER_MAP) {
    if (m.ids.includes(p.provider_id)) return m.canonical;
    if (m.re.test(String(p.provider_name || ""))) return m.canonical;
  }
  return null;
}

function tmdbAuth() {
  const key = process.env.TMDB_API_KEY || "";
  // v4 Read Access Token (JWT) → header; v3 api key corta → query param.
  return key.startsWith("eyJ")
    ? { header: { Authorization: `Bearer ${key}` }, query: "" }
    : { header: {}, query: `api_key=${encodeURIComponent(key)}` };
}

async function tmdbGet(path, params) {
  const auth = tmdbAuth();
  const qs = [params, auth.query].filter(Boolean).join("&");
  const res = await fetchUpstream(`${TMDB}${path}?${qs}`, {
    headers: { accept: "application/json", ...auth.header },
  }, { timeoutMs: 8000, retries: 1 });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status} en ${path}`);
  return res.json();
}

// Normalización para comparar títulos: minúsculas, sin tildes ni puntuación.
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Score de candidato de búsqueda: el título tiene que matchear de verdad
// (misma idea que scoreTitle de apps/mobile/src/lib/justwatch.ts) y el año
// ayuda a desempatar. Debajo de MIN_SCORE se considera "no encontrado".
const MIN_SCORE = 3;
function scoreCandidate(c, wantedNorm, wantedYear) {
  const names = [c.title, c.name, c.original_title, c.original_name].map(norm).filter(Boolean);
  let s = 0;
  if (names.some((n) => n === wantedNorm)) s += 3;
  else if (names.some((n) => n.includes(wantedNorm) || wantedNorm.includes(n))) s += 1.5;
  const date = c.release_date || c.first_air_date || "";
  const y = parseInt(date.slice(0, 4), 10);
  if (wantedYear && Number.isFinite(y)) {
    const d = Math.abs(y - wantedYear);
    if (d <= 1) s += 1.5;
    else if (d <= 3) s += 0.5;
    else s -= 0.5;
  }
  s += Math.min(1, (c.popularity || 0) / 100); // desempate suave
  return s;
}

// ── Caché en memoria keyed por título+año+tipo+país ──────────────────────────
// TTL 7 días; ante error de TMDB se sirve stale si existe (patrón de
// trending.functions.ts: nunca romper por una fuente externa caída).
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
const cache = new Map(); // key → { at, value }

function cacheGet(key, allowStale) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (allowStale || Date.now() - hit.at < CACHE_TTL) return hit.value;
  return undefined;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    // Eviction simple por orden de inserción (Map lo garantiza).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * Resuelve un título contra TMDB y devuelve dónde se ve en `country`.
 * @returns {Promise<{tmdbId:number, providers:string[], posterUrl:string|null}|null>}
 *   null = no se pudo resolver (sin match confiable o TMDB caído): NO afirma
 *   que el título no exista — el caller debe degradar suave (dejarlo pasar).
 */
export async function resolveTitle(title, year, type, country) {
  if (!availabilityEnabled() || !String(title || "").trim()) return null;
  const kind = /serie/i.test(String(type || "")) ? "tv" : "movie";
  const wantedYear = year ? parseInt(year, 10) : NaN;
  const region = String(country || DEFAULT_REGION).toUpperCase().slice(0, 2) || DEFAULT_REGION;
  const key = `${norm(title)}|${Number.isFinite(wantedYear) ? wantedYear : ""}|${kind}|${region}`;

  const fresh = cacheGet(key, false);
  if (fresh !== undefined) return fresh;

  try {
    const search = await tmdbGet(`/search/${kind}`, `query=${encodeURIComponent(String(title).trim())}&language=es-AR&include_adult=false`);
    const wantedNorm = norm(title);
    let best = null;
    let bestScore = -Infinity;
    for (const c of (search.results || []).slice(0, 8)) {
      const s = scoreCandidate(c, wantedNorm, Number.isFinite(wantedYear) ? wantedYear : null);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best || bestScore < MIN_SCORE) {
      cacheSet(key, null); // "no encontrado" también se cachea (evita re-buscar)
      return null;
    }

    const wp = await tmdbGet(`/${kind}/${best.id}/watch/providers`, "");
    const offers = (wp.results && wp.results[region]) || {};
    // flatrate = suscripción; ads = tier con anuncios de la misma plataforma.
    const raw = [...(offers.flatrate || []), ...(offers.ads || [])];
    const providers = [...new Set(raw.map(canonicalProvider).filter(Boolean))];

    const value = {
      tmdbId: best.id,
      providers,
      posterUrl: best.poster_path ? IMG + best.poster_path : null,
    };
    cacheSet(key, value);
    return value;
  } catch (e) {
    const stale = cacheGet(key, true);
    if (stale !== undefined) return stale;
    console.warn(`[availability] TMDB falló para "${title}": ${e.message}`);
    return null;
  }
}

/**
 * Valida una tanda de ítems del LLM contra la disponibilidad real.
 * Anota cada ítem con `_avail`:
 *   "confirmed"  → está en la plataforma que dijo Haiku
 *   "corrected"  → estaba en OTRA plataforma (del usuario, si hay filtro) y se corrigió item.platform
 *   "unlisted"   → está en streaming pero en ninguna plataforma del usuario
 *   "none"       → resuelto en TMDB y sin streaming por suscripción en el país
 *   "unknown"    → no se pudo resolver (degradar suave: tratarlo como hoy)
 * También completa posterUrl si faltaba. Muta y devuelve el mismo array.
 * @param {Array<{title:string, platform:string, type?:string, year?:number|string, posterUrl?:string}>} items
 * @param {string[]|null} userPlatforms - plataformas del usuario (null = todas)
 * @param {string} [country]
 */
export async function validateItems(items, userPlatforms, country) {
  if (!availabilityEnabled() || !items || !items.length) {
    for (const it of items || []) it._avail = "unknown";
    return items || [];
  }
  const wanted = userPlatforms && userPlatforms.length
    ? new Set(userPlatforms.map((p) => norm(p)))
    : null;
  const inWanted = (name) => !wanted || wanted.has(norm(name));

  await Promise.all(items.map(async (it) => {
    const r = await resolveTitle(it.title, it.year, it.type, country);
    if (!r) { it._avail = "unknown"; return; }
    if (r.posterUrl && !it.posterUrl) it.posterUrl = r.posterUrl;
    if (!r.providers.length) { it._avail = "none"; return; }
    if (r.providers.some((p) => norm(p) === norm(it.platform)) && inWanted(it.platform)) {
      it._avail = "confirmed";
      return;
    }
    const candidate = r.providers.find(inWanted);
    if (candidate) {
      it.platform = candidate;
      it._avail = "corrected";
      return;
    }
    it._avail = "unlisted";
  }));
  return items;
}

/**
 * Filtra el resultado de validateItems: disponibles primero (confirmed +
 * corrected), después los "unknown" (nunca peor que hoy); descarta "none" y
 * "unlisted". Limpia el campo interno _avail y corta en `want`.
 */
export function pickAvailable(items, want) {
  const ok = [];
  const unknown = [];
  for (const it of items || []) {
    const a = it._avail;
    delete it._avail;
    if (a === "confirmed" || a === "corrected") ok.push(it);
    else if (a === "unknown" || a === undefined) unknown.push(it);
  }
  return ok.concat(unknown).slice(0, want);
}
