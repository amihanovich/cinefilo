import { fetchUpstream } from "./upstream.mjs";
import { validateItems, pickAvailable } from "./availability.mjs";

// Búsqueda y home para la TV liviana (navegadores viejos: Tizen 4.0, etc.).
// Módulo Node autónomo: NO depende del bundle de la app. Lo usa server-node.mjs en
// /api/tv-search y /api/tv-home. Llama directo a la API REST de Anthropic.
// Los pósters NO se buscan acá (iTunes bloquea la IP del server): los trae la TV
// del lado del cliente (IP residencial).

// Sin Star+: murió en 2024 (fusionada con Disney+ en LatAm). Estaba dejando
// que Haiku la asigne y la TV disparaba el deep link de una app que ya no existe.
const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];

async function callAnthropic(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  const res = await fetchUpstream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens || 4500,
      messages: [{ role: "user", content: prompt }],
    }),
  }, { timeoutMs: 60000 });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

// Nota: los pósters NO se buscan acá. Los trae la TV del lado del cliente vía Cinemeta
// (catálogo público de Stremio, con CORS y sin clave), llenándose de a poco.

function normalizeItem(r, section) {
  const yearNum = r.year ? parseInt(r.year, 10) : NaN;
  const item = {
    title: String(r.title || ""),
    platform: String(r.platform || ""),
    type: String(r.type || ""),
    synopsis: r.synopsis ? String(r.synopsis) : undefined,
    hook: r.hook ? String(r.hook) : undefined,
    reason: r.reason ? String(r.reason) : undefined,
  };
  if (Number.isFinite(yearNum)) item.year = yearNum;
  if (section) item.section = section;
  return item;
}

const ITEM_SHAPE =
  '{"title":"","platform":"","year":"","type":"Película","synopsis":"","hook":"","reason":""}';
const itemRules = (plats) =>
  '- "platform" EXACTAMENTE una de: ' +
  plats.join(", ") +
  '.\n- "type" es "Película" o "Serie".\n- "year" año de estreno (ej "2019").\n' +
  '- "synopsis": una frase (máx 18 palabras) de qué trata, sin spoilers.\n' +
  '- "hook": el porqué de la recomendación en UNA frase ultra concreta y visual, ' +
  'empezando con "Porque", máximo 8 palabras, sin punto final. Ejemplos: ' +
  '"Porque hay persecuciones y acción en Latinoamérica", "Porque hay espadas ' +
  'medievales y honor en juego", "Porque hay identidades duplicadas y paranoia". ' +
  "Es lo único que se lee en la tarjeta chica: concreto, nada de frases genéricas.\n" +
  '- "reason": 2 o 3 frases (40 a 60 palabras) que enganchen y den ganas de darle play. ' +
  "Lo primero y central es EL PORQUÉ: conectá explícitamente con lo que se pidió o con el momento " +
  "(nada de elogios genéricos tipo 'gran película'). Después el tono/clima (tenso, luminoso, " +
  "melancólico, divertido...) y qué la vuelve memorable (una actuación, la dirección, el giro emocional); " +
  "si suma, un dato de cinéfilo breve (director, época, conexión). Cálido y conversacional en rioplatense, " +
  "como el experto del videoclub que te la recomienda a VOS; sin spoilers ni frases hechas repetidas entre ítems." +
  "\n- Títulos conocidos con disponibilidad estable.";

export async function tvSearch(query, exclude, liked, disliked, platforms, country) {
  if (!query || !query.trim()) return { items: [] };
  // Plataformas del usuario (si las mandó el control) — restringen el prompt Y
  // la validación de disponibilidad. Antes la TV siempre buscaba en las 7.
  const plats = platforms && platforms.length ? platforms : PLATFORMS;
  const excludeLine =
    exclude && exclude.length
      ? "\n\nNO recomiendes estos títulos (ya vistos o mostrados): " + exclude.join(", ")
      : "";
  const likedLine =
    liked && liked.length
      ? "\n\nAl usuario LE GUSTARON (señal fuerte: buscá en esa línea — mismo tono, género, director, sensibilidad; NO los repitas): " +
        liked.join(", ")
      : "";
  const dislikedLine =
    disliked && disliked.length
      ? "\n\nNO le gustaron (señal negativa: evitá títulos similares en tono/género/director): " +
        disliked.join(", ")
      : "";
  const prompt =
    "Sos un experto en cine y series en español rioplatense. Plataformas: " +
    plats.join(", ") +
    '.\nEl usuario quiere ver: "' +
    query.trim() +
    '".' +
    excludeLine +
    likedLine +
    dislikedLine +
    "\n\nDevolvé ÚNICAMENTE JSON válido (sin markdown):\n" +
    '{"items":[' +
    ITEM_SHAPE +
    "]}\n\nReglas:\n- EXACTAMENTE 18 ítems distintos entre sí.\n" +
    itemRules(plats) +
    '\n- Si un título se aleja del pedido, aclaralo en "reason" (ej "Se aleja un poco, pero...").';
  // Se piden 18 y se devuelven hasta 15: el margen absorbe los que la
  // validación de disponibilidad (TMDB, por país) descarta o no confirma.
  const parsed = await callAnthropic(prompt, 5500);
  const items = ((parsed && parsed.items) || []).map((r) => normalizeItem(r, undefined));
  await validateItems(items, platforms && platforms.length ? platforms : null, country);
  return { items: pickAvailable(items, 15) };
}

// Póster desde Cinemeta, resuelto EN EL SERVIDOR. Antes cada TV hacía 1 request
// por título (12 en la pantalla de pairing) y las tiras tardaban en aparecer.
// Acá se resuelven en paralelo UNA vez y quedan dentro del caché del home (6 h),
// así el cliente recibe los pósters ya listos en /api/tv-home.
async function cinemetaPoster(title, type) {
  const kind = /serie/i.test(type || "") ? "series" : "movie";
  const u = "https://v3-cinemeta.strem.io/catalog/" + kind + "/top/search=" +
    encodeURIComponent(title) + ".json";
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j && j.metas && j.metas[0];
    let poster = m && m.poster ? String(m.poster) : null;
    // Cinemeta devuelve la variante "medium" (~250px): en 1080p se pixela.
    if (poster) poster = poster.replace("/poster/medium/", "/poster/big/");
    return poster;
  } catch {
    return null; // sin póster no se rompe nada: el cliente cae a su propio fetch
  }
}

async function attachPosters(items) {
  await Promise.all(
    items.map(async (it) => {
      if (it && !it.posterUrl) {
        const p = await cinemetaPoster(it.title, it.type);
        if (p) it.posterUrl = p;
      }
    }),
  );
  return items;
}

// Caché en memoria del home (mismo para todos; evita la espera de la IA en cada visita).
let homeCache = null;
let homeCacheAt = 0;
const HOME_TTL = 6 * 60 * 60 * 1000;

export async function tvHome() {
  const now = Date.now();
  if (homeCache && now - homeCacheAt < HOME_TTL) return homeCache;
  const prompt =
    "Sos un experto en cine y series en español rioplatense. Plataformas: " +
    PLATFORMS.join(", ") +
    ".\nArmá dos listas para la pantalla de inicio de una app de TV.\n\n" +
    "Devolvé ÚNICAMENTE JSON válido (sin markdown):\n" +
    '{"recommended":[' +
    ITEM_SHAPE +
    '],"latest":[' +
    ITEM_SHAPE +
    "]}\n\nReglas:\n" +
    '- "recommended": EXACTAMENTE 10 títulos excelentes y variados (distintos géneros y plataformas), atemporales y muy recomendables.\n' +
    '- "latest": EXACTAMENTE 10 estrenos recientes (2024-2025) populares, variados, repartidos entre las distintas plataformas.\n' +
    "- Sin repetir títulos entre las dos listas.\n" +
    itemRules(PLATFORMS);
  // 10+10 → 8+8: el margen absorbe los descartes de la validación de
  // disponibilidad. El home es global (cacheado para todos), así que valida
  // contra TODAS las plataformas en la región default — el filtro por usuario
  // pasa en la búsqueda, que sí es por request.
  const parsed = await callAnthropic(prompt, 6000);
  const rec = ((parsed && parsed.recommended) || []).map((r) =>
    normalizeItem(r, "Recomendadas para vos"),
  );
  const latest = ((parsed && parsed.latest) || []).map((r) =>
    normalizeItem(r, "Últimas subidas a las plataformas"),
  );
  await validateItems(rec.concat(latest), null, undefined);
  const items = await attachPosters(
    pickAvailable(rec, 8).concat(pickAvailable(latest, 8)),
  );
  homeCache = { items: items };
  homeCacheAt = Date.now();
  return homeCache;
}

// Más recomendaciones para la carga infinita del home.
export async function tvHomeMore(exclude, platforms, country) {
  const plats = platforms && platforms.length ? platforms : PLATFORMS;
  const excludeLine =
    exclude && exclude.length
      ? "\n\nNO repitas estos (ya se mostraron): " + exclude.slice(0, 50).join(", ")
      : "";
  const prompt =
    "Sos un experto en cine y series en español rioplatense. Plataformas: " +
    plats.join(", ") +
    ".\nDevolvé MÁS recomendaciones excelentes y variadas para la pantalla de inicio." +
    excludeLine +
    "\n\nDevolvé ÚNICAMENTE JSON válido (sin markdown):\n" +
    '{"items":[' +
    ITEM_SHAPE +
    "]}\n\nReglas:\n- EXACTAMENTE 10 títulos, variados (distintos géneros y plataformas), distintos entre sí.\n" +
    itemRules(plats);
  const parsed = await callAnthropic(prompt, 4500);
  const items = ((parsed && parsed.items) || []).map((r) =>
    normalizeItem(r, "Más recomendadas para vos"),
  );
  await validateItems(items, platforms && platforms.length ? platforms : null, country);
  return { items: pickAvailable(items, 8) };
}

// Pre-cargar el home al arrancar el server (para que el primer usuario no espere a la IA).
export function warmHome() {
  tvHome().catch(function () {});
}
