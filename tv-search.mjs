// Búsqueda y home para la TV liviana (navegadores viejos: Tizen 4.0, etc.).
// Módulo Node autónomo: NO depende del bundle de la app. Lo usa server-node.mjs en
// /api/tv-search y /api/tv-home. Llama directo a la API REST de Anthropic.
// Los pósters NO se buscan acá (iTunes bloquea la IP del server): los trae la TV
// del lado del cliente (IP residencial).

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];

async function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
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
    reason: r.reason ? String(r.reason) : undefined,
  };
  if (Number.isFinite(yearNum)) item.year = yearNum;
  if (section) item.section = section;
  return item;
}

const ITEM_SHAPE =
  '{"title":"","platform":"","year":"","type":"Película","synopsis":"","reason":""}';
const ITEM_RULES =
  '- "platform" EXACTAMENTE una de: ' +
  PLATFORMS.join(", ") +
  '.\n- "type" es "Película" o "Serie".\n- "year" año de estreno (ej "2019").\n' +
  '- "synopsis": una frase (máx 18 palabras) de qué trata, sin spoilers.\n' +
  '- "reason": por qué encaja (máx 16 palabras).\n- Títulos conocidos con disponibilidad estable.';

export async function tvSearch(query, exclude, liked, disliked) {
  if (!query || !query.trim()) return { items: [] };
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
    PLATFORMS.join(", ") +
    '.\nEl usuario quiere ver: "' +
    query.trim() +
    '".' +
    excludeLine +
    likedLine +
    dislikedLine +
    "\n\nDevolvé ÚNICAMENTE JSON válido (sin markdown):\n" +
    '{"items":[' +
    ITEM_SHAPE +
    "]}\n\nReglas:\n- EXACTAMENTE 15 ítems distintos entre sí.\n" +
    ITEM_RULES +
    '\n- Si un título se aleja del pedido, aclaralo en "reason" (ej "Se aleja un poco, pero...").';
  const parsed = await callAnthropic(prompt);
  const items = ((parsed && parsed.items) || []).map((r) => normalizeItem(r, undefined));
  return { items };
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
    '- "recommended": EXACTAMENTE 8 títulos excelentes y variados (distintos géneros y plataformas), atemporales y muy recomendables.\n' +
    '- "latest": EXACTAMENTE 8 estrenos recientes (2024-2025) populares, variados, repartidos entre las distintas plataformas.\n' +
    "- Sin repetir títulos entre las dos listas.\n" +
    ITEM_RULES;
  const parsed = await callAnthropic(prompt);
  const rec = ((parsed && parsed.recommended) || []).map((r) =>
    normalizeItem(r, "Recomendadas para vos"),
  );
  const latest = ((parsed && parsed.latest) || []).map((r) =>
    normalizeItem(r, "Últimas subidas a las plataformas"),
  );
  const items = rec.concat(latest);
  homeCache = { items: items };
  homeCacheAt = Date.now();
  return homeCache;
}

// Más recomendaciones para la carga infinita del home.
export async function tvHomeMore(exclude) {
  const excludeLine =
    exclude && exclude.length
      ? "\n\nNO repitas estos (ya se mostraron): " + exclude.slice(0, 50).join(", ")
      : "";
  const prompt =
    "Sos un experto en cine y series en español rioplatense. Plataformas: " +
    PLATFORMS.join(", ") +
    ".\nDevolvé MÁS recomendaciones excelentes y variadas para la pantalla de inicio." +
    excludeLine +
    "\n\nDevolvé ÚNICAMENTE JSON válido (sin markdown):\n" +
    '{"items":[' +
    ITEM_SHAPE +
    "]}\n\nReglas:\n- EXACTAMENTE 8 títulos, variados (distintos géneros y plataformas), distintos entre sí.\n" +
    ITEM_RULES;
  const parsed = await callAnthropic(prompt);
  const items = ((parsed && parsed.items) || []).map((r) =>
    normalizeItem(r, "Más recomendadas para vos"),
  );
  return { items };
}

// Pre-cargar el home al arrancar el server (para que el primer usuario no espere a la IA).
export function warmHome() {
  tvHome().catch(function () {});
}
