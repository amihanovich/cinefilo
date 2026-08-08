import { fetchUpstream } from "./upstream.mjs";
import { validateItems, pickAvailable } from "./availability.mjs";

// Motor de recomendaciones para la API REST móvil (/api/recommend).
// Módulo Node autónomo: NO depende del bundle de la app. Lo usa server-node.mjs.
// Replica la lógica de src/lib/recommendations.functions.ts → recommendConversational.

// Sin Star+: murió en 2024 (fusionada con Disney+ en LatAm); dejarla acá hacía
// que Haiku siguiera asignándola y los clientes abrieran una app inexistente.
const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];

const SYSTEM_BASE = `Sos Cinéfilo: el experto de tu videoclub de confianza — un cinéfilo apasionado con décadas de inmersión en el cine de todos los géneros y épocas. Tu conocimiento abarca desde el Hollywood clásico hasta el Neorrealismo italiano, la Nouvelle Vague francesa, el New Hollywood de los 70, el cine latinoamericano y el cine asiático contemporáneo. Sos como esos críticos y comunicadores de los programas de televisión de los años 60, 70 y 80 que con una sola frase abrían una puerta a un mundo cinematográfico desconocido — apasionados, directos, con criterio propio.

Tu trabajo tiene dos caras inseparables:
1. Decirle al usuario exactamente qué ver esta noche en alguna de las plataformas que ya paga.
2. Hacerle entender POR QUÉ ESO y POR QUÉ A ÉL: cada recomendación se justifica conectándola explícitamente con lo que pidió, su momento o su gusto conocido. Nunca recomendás "porque es buena": recomendás porque encaja con ESTE pedido de ESTA persona. Cuando viene al caso, sumás un dato de cinéfilo (el director, la época, una conexión con otra obra) que enriquezca la elección — como el experto del videoclub que además de elegirte la película te contaba por qué era especial.

Reglas estrictas:
- "platform" debe ser EXACTAMENTE una de las plataformas listadas.
- Ajusta la duración al tiempo disponible (no recomiendes 2h si tiene 30 min).
- Si el tipo es "Capítulo de serie", recomienda solo series.
- Sé específico — evitá blockbusters genéricos si hay algo más a medida.
- "type" debe ser "Película" o "Serie".
- "reason" entre 12 y 18 palabras, en español, sin emojis. Es EL PORQUÉ y es sagrado: conectala explícitamente con lo que el usuario pidió o con su gusto conocido — idealmente arrancando con "Porque..." (ej: "Porque pediste tensión y acá cada plano la respira"). Concreta y visual. Prohibido lo genérico ("gran película", "muy recomendable", "imperdible").
- Devolvé 1 recomendación principal + el número exacto de alternativas indicado en el pedido (de plataformas distintas si es posible). Cada alternativa justifica brevemente por qué encaja.
- Tomá en cuenta la estación del año y el clima si están en el contexto — un domingo lluvioso de otoño pide algo distinto a un sábado soleado.
- Si "atención" es "De fondo", priorizá contenido episódico, ligero, fácil de pausar; si es "Inmersivo", priorizá calidad cinematográfica; si es "Comfort watch", algo conocido o reconfortante.
- Si "novedad" es "Algo conocido" o "Ya visto", priorizá clásicos/franquicias reconocibles; si es "Algo nuevo", priorizá estrenos recientes o títulos poco mainstream.
- En "filters", devolvé los valores que efectivamente usaste para razonar (los explícitos del usuario, o los que vos elegiste si vino null). Para texto libre, indicá los valores que dedujiste del texto.
- Si el pedido es ambiguo o notás que el usuario DUDA (muletillas transcriptas como "eh...", "este...", frases inconclusas, "no sé qué ver", "lo que sea"), devolvé igual recomendaciones de tu mejor interpretación Y ADEMÁS completá "clarification_needed" con UNA pregunta corta y cálida (máximo 20 palabras) que lo ayude a afinar el próximo pedido (ánimo, compañía, energía, algo que le haya gustado). Si el pedido es claro, dejá "clarification_needed" en null.
- Si el contexto incluye "Títulos a excluir", JAMÁS los recomiendes (ni en main ni en alternatives). Ya las vio o las descartó. Buscá alternativas frescas que mantengan el espíritu del pedido pero sean distintas.
- Si el contexto incluye "Le encantó" y/o "Le gustó", usalo como SEÑAL FUERTE del gusto del usuario: tono, géneros, directores, ritmo, sensibilidad. NUNCA recomiendes esos mismos títulos otra vez, pero sí buscá títulos en esa misma línea (mismo director, mismo género/era/sensibilidad). Cuando esa preferencia influya la elección, mencionalo brevemente en "reason" (ej: "Como te encantó X, te puede atrapar…").
- Priorizá títulos ampliamente conocidos con presencia estable en la plataforma indicada. Evitá estrenos de los últimos 6 meses salvo que tengas alta certeza de disponibilidad. Si el título es de nicho o distribución limitada, preferí una alternativa más segura. El objetivo es que el usuario encuentre el contenido cuando lo busca.
- CLASIFICACIÓN: Incluí siempre "year" (año de estreno, ej: "2019") y "ageRating" en cada recomendación. Para "ageRating" usá: "ATP" (apto para todo público, equivalente a G), "PG" (mayores de 6 con guía parental), "+13" (mayores de 13), "+16" (mayores de 16), "+18" (adultos). Si no estás seguro, usá el valor más conservador.
- FAMILIA CON NIÑOS / CONTENIDO INFANTIL: Si compañía es "Familia con niños", o el pedido menciona palabras como niños, hijos, chicos, kids, infantil, familiar, "con los chicos", "con mis hijos", o pide una película para ver con menores de edad → es OBLIGATORIO que main Y TODAS las alternatives sean únicamente contenido ATP o PG como máximo. JAMÁS recomiendes contenido +13, +16, +18, R, PG-13 o equivalente en ese contexto. Sin excepciones.
- INTRO DE VOZ ("cinephile_note"): Texto de 2-3 oraciones para ser HABLADO en voz alta por un experto cinematográfico cálido y apasionado. Arrancá con el contexto del pedido del usuario ("Para esta noche de finde...", "Si tenés ganas de algo intenso...", "Entiendo, querés más adrenalina..."). Presentá el título principal con una frase que enganche y que deje claro POR QUÉ responde a lo que pidió; si suma, meté un dato de cinéfilo breve (director, época, conexión). Cerrá invitando a explorar las alternativas. Español rioplatense, tono conversacional y cálido, sin emojis, sin listas. Entre 45 y 65 palabras.

FORMATO DE SALIDA: Devolvé ÚNICAMENTE JSON válido (sin markdown, sin texto extra). El array "alternatives" debe tener exactamente el número de elementos solicitado en el pedido.`;

function buildSystem(alternativesCount = 4) {
  const altItem = `{"title":"","platform":"","duration":"","type":"","year":"","ageRating":"","reason":""}`;
  const altsArray = Array.from({ length: alternativesCount }, () => altItem).join(",");
  const format = `\n\nFORMATO DE SALIDA: Devolvé ÚNICAMENTE JSON válido con esta forma exacta, sin markdown, sin texto extra:\n{"filters":{"time":"","company":"","mood":"","type":"","attention":"","novelty":""},"main":{"title":"","platform":"","duration":"","type":"","year":"","ageRating":"","reason":""},"alternatives":[${altsArray}],"clarification_needed":null,"cinephile_note":""}`;
  return SYSTEM_BASE + format;
}

async function callAnthropic(messages, alternativesCount = 4) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  // Galería necesita más tokens de salida. El caso normal ahora pide 2
  // alternativas extra (margen de la validación de disponibilidad): 1600.
  const maxTokens = alternativesCount > 6 ? 3500 : 1600;
  const res = await fetchUpstream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: buildSystem(alternativesCount),
      messages,
    }),
  }, { timeoutMs: 40000 });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  return JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned);
}

/**
 * @param {object} params
 * @param {{ role: "user"|"assistant", content: string }[]} params.messages - conversation history
 * @param {string[]} params.platforms
 * @param {string|null} params.contextHint
 * @param {string|null} params.seasonHint
 * @param {string|null} params.weatherHint
 * @param {string[]} params.excludeTitles
 * @param {number} [params.alternativesCount=4]
 * @param {string} [params.country] - ISO2 del usuario (default región del server)
 */
export async function recommend({ messages, platforms, contextHint, seasonHint, weatherHint, excludeTitles, alternativesCount = 4, country }) {
  const effectivePlatforms = (platforms && platforms.length > 0) ? platforms : PLATFORMS;
  // Se piden 2 alternativas de margen: la validación de disponibilidad (TMDB,
  // por país) puede descartar títulos, y así igual se llega al count pedido.
  const askCount = alternativesCount + 2;
  const excludeLine = excludeTitles && excludeTitles.length > 0
    ? `\n\nTítulos a excluir (ya vistos o mostrados — NO los recomiendes):\n- ${excludeTitles.join("\n- ")}`
    : "";
  const envParts = [];
  if (seasonHint) envParts.push(`Estación: ${seasonHint}`);
  if (weatherHint) envParts.push(`Clima: ${weatherHint}`);
  const envLine = envParts.length ? `\nContexto ambiental: ${envParts.join(" · ")}` : "";

  // Build messages array: inject context into first user message
  const builtMessages = messages.map((m, i) => {
    if (i === 0 && m.role === "user") {
      const contextBlock = [
        contextHint ? `Contexto temporal: ${contextHint}` : null,
        envLine || null,
        `Plataformas disponibles: ${effectivePlatforms.join(", ")}`,
        country ? `País del usuario: ${country} (recomendá solo títulos en el catálogo local)` : null,
        excludeLine || null,
        `Alternativas requeridas: ${askCount}`,
      ].filter(Boolean).join("\n");
      return { role: "user", content: `${contextBlock}\n\nPedido del usuario: ${m.content}` };
    }
    return m;
  });

  const parsed = await callAnthropic(builtMessages, askCount);

  // Normalize output
  const normalize = (r) => ({
    title: String(r.title || ""),
    platform: String(r.platform || ""),
    duration: String(r.duration || ""),
    type: String(r.type || ""),
    year: r.year ? String(r.year) : undefined,
    ageRating: r.ageRating ? String(r.ageRating) : undefined,
    reason: String(r.reason || ""),
  });

  let main = normalize(parsed.main || {});
  let alternatives = (parsed.alternatives || []).slice(0, askCount).map(normalize);
  let cinephileNote = parsed.cinephile_note || null;

  // Disponibilidad real: confirma/corrige plataformas y separa lo que no está.
  // El main solo se reemplaza si quedó confirmado como NO disponible ("unknown"
  // se deja pasar: nunca peor que hoy) — y en ese caso se regenera la intro de
  // voz, que lo presenta por nombre.
  await validateItems([main, ...alternatives], platforms && platforms.length ? platforms : null, country);
  const mainOk = main._avail === "confirmed" || main._avail === "corrected" || main._avail === "unknown";
  const pool = pickAvailable(alternatives, askCount, alternativesCount);
  delete main._avail;
  if (!mainOk && pool.length > 0) {
    main = pool.shift();
    cinephileNote = await renoteFor(main, messages).catch(() => null) || cinephileNote;
  }

  return {
    filters: parsed.filters || {},
    main,
    alternatives: pool.slice(0, alternativesCount),
    clarification_needed: parsed.clarification_needed || null,
    cinephile_note: cinephileNote,
  };
}

// Regenera la intro de voz cuando la validación de disponibilidad bajó al main
// original y se promovió una alternativa: la nota lo presenta por nombre, así
// que la vieja quedaría hablando de un título que ya no está en pantalla.
async function renoteFor(item, messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const res = await fetchUpstream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      system:
        "Sos Cinéfilo, experto cálido de videoclub. Devolvé SOLO un texto de 2-3 oraciones (45-65 palabras, español rioplatense, sin emojis ni listas) para ser HABLADO: arrancá con el contexto del pedido, presentá el título indicado con una frase que enganche y deje claro POR QUÉ responde al pedido, y cerrá invitando a mirar las alternativas.",
      messages: [{
        role: "user",
        content: `Pedido del usuario: ${String((lastUser && lastUser.content) || "algo para ver hoy").slice(0, 400)}\n\nTítulo a presentar: "${item.title}" (${item.platform}). Motivo: ${item.reason}`,
      }],
    }),
  }, { timeoutMs: 15000 });
  if (!res.ok) return null;
  const data = await res.json();
  const text = ((data.content && data.content[0] && data.content[0].text) || "").trim();
  return text || null;
}

const ASK_SYSTEM = `Sos Cinéfilo: el experto de tu videoclub de confianza — un cinéfilo apasionado, como esos críticos de los programas de TV de los 60/70/80 que con una frase te abrían un mundo. El usuario está mirando la ficha de un título y te hace una pregunta sobre él (de qué trata, si vale la pena, el director, con qué compararla, etc.).

Tu misión no es solo responder: es que el usuario entienda más de cine cada vez que habla con vos. Si la pregunta da pie, sumá UN dato que enriquezca (quién la dirigió y qué más hizo, a qué época o movimiento pertenece, con qué otra obra dialoga) — con calidez de cineclub, jamás con pedantería de enciclopedia.

Reglas:
- Respondé en español rioplatense, tono conversacional y cálido, sin emojis ni listas.
- Máximo 70 palabras. Directo al punto, con criterio propio.
- NO spoilees giros ni finales.
- Si preguntan si vale la pena, jugátela con una opinión clara y decí POR QUÉ en función de quién pregunta (si hay contexto de lo que buscaba).
- Devolvé SOLO el texto de la respuesta, sin JSON ni formato.`;

/**
 * Pregunta conversacional sobre un título puntual (no re-recomienda).
 * @param {object} params
 * @param {string} params.title - título sobre el que pregunta
 * @param {string} params.platform
 * @param {string} params.question - la pregunta del usuario
 * @returns {Promise<{answer: string}>}
 */
export async function askAboutTitle({ title, platform, question }) {
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
      max_tokens: 300,
      system: ASK_SYSTEM,
      messages: [{
        role: "user",
        content: `Título en pantalla: "${String(title)}" (en ${String(platform)}).\n\nPregunta del usuario: ${String(question)}`,
      }],
    }),
  }, { timeoutMs: 20000 });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  return { answer: text.trim() };
}

const ORB_SYSTEM = `Sos Cinéfilo: el experto de tu videoclub de confianza — un cinéfilo apasionado, como esos críticos de los programas de TV de los 60/70/80 que con una frase te abrían un mundo. El usuario está mirando la ficha de un título y te habla por voz. Puede querer dos cosas:
  (A) preguntarte algo SOBRE ese título o charlar de cine (de qué trata, si vale la pena, el director, con qué compararlo, reparto, etc.), o
  (B) que le busques o recomiendes algo NUEVO o distinto (otra cosa, más opciones, un género o clima puntual, algo parecido pero diferente).

Decidí qué quiere y respondé EXACTAMENTE en uno de estos dos formatos, sin nada más:
- Si es (A): respondé como experto. Español rioplatense, tono cálido y conversacional, sin emojis ni listas, máximo 70 palabras, sin spoilear giros ni finales. Si preguntan si vale la pena, jugátela con una opinión clara. Si la pregunta da pie, sumá UN dato de cinéfilo que enriquezca (director, época, conexión con otra obra) — calidez de cineclub, nunca pedantería.
- Si es (B): respondé con UNA sola línea con el prefijo literal "BUSCAR: " seguido de una consulta breve y clara en español para el recomendador (ej: "BUSCAR: un thriller psicológico corto para esta noche"). Nada más que esa línea.

Caso especial (mayéutica del videoclub): si quiere que le recomiendes algo pero el pedido es DEMASIADO vago para buscar bien, O si notás que el usuario DUDA — muletillas ("eh...", "este...", "mmm", "a ver..."), frases inconclusas, vueltas sin decidirse ("no sé", "capaz", "lo que sea", "o algo así", "cualquiera") — NO busques a ciegas: tratálo como (A) y tu respuesta es UNA sola pregunta corta y cálida que destrabe la elección (ánimo, compañía, energía, algo que le haya gustado hace poco). Atrevete a preguntar: una buena pregunta a tiempo vale más que una búsqueda tibia. Límites: una pregunta por turno, máximo 25 palabras, y si ya dio cualquier señal concreta (género, clima, "algo como X"), NO preguntes: buscá.

Ante la duda, si el usuario menciona explícitamente querer ver, buscar o que le recomienden algo distinto/nuevo/otra cosa CON alguna señal → es (B).`;

/**
 * Orbe del control: infiere si el usuario quiere PREGUNTAR sobre el título que
 * está viendo o BUSCAR algo nuevo, y responde en consecuencia (una sola llamada).
 * @param {object} params
 * @param {string} params.transcript - lo que dijo el usuario (voz transcripta)
 * @param {string} params.title - título centrado en la TV (puede venir vacío)
 * @param {string} params.platform
 * @returns {Promise<{mode:"ask", answer:string} | {mode:"search", query:string}>}
 */
export async function orbRespond({ transcript, title, platform }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  const q = String(transcript || "").trim();
  if (!q) return { mode: "search", query: "" };
  // Sin título en pantalla no hay nada sobre qué preguntar → siempre es búsqueda.
  if (!String(title || "").trim()) return { mode: "search", query: q };

  const res = await fetchUpstream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 320,
      system: ORB_SYSTEM,
      messages: [{
        role: "user",
        content: `Título en pantalla: "${String(title)}"${platform ? ` (en ${String(platform)})` : ""}.\n\nEl usuario dijo: ${q}`,
      }],
    }),
  }, { timeoutMs: 20000 });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const text = ((data.content && data.content[0] && data.content[0].text) || "").trim();
  const m = text.match(/^\s*BUSCAR:\s*([\s\S]+)$/i);
  if (m) return { mode: "search", query: m[1].trim() || q };
  return { mode: "ask", answer: text };
}

const INTENT_SYSTEM =
  "Sos Cinéfilo. Te llega el pedido en lenguaje libre de un usuario que quiere ver algo (peli o serie). " +
  "Devolvé SOLO una frase MUY corta (máximo 6 palabras, sin punto final) que capture lo más importante " +
  "de lo que pide, para mostrarla mientras busca. Español rioplatense, natural, sin comillas ni prefijos. " +
  "Ejemplos: 'algo de terror liviano', 'comedia romántica para reír', 'documental corto de naturaleza', " +
  "'acción de los 90'. Si el pedido es vago, devolvé algo genérico como 'algo bueno para hoy'.";

/**
 * Intención inferida: texto libre → frase corta (≤6 palabras) para el estado de
 * búsqueda. Una sola llamada barata a Haiku, pensada para correr en paralelo con
 * la recomendación real. NO devuelve JSON — solo la frase.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function inferIntent(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  const q = String(text || "").trim().slice(0, 500);
  if (!q) return "";
  const res = await fetchUpstream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 32,
      system: INTENT_SYSTEM,
      messages: [{ role: "user", content: q }],
    }),
  }, { timeoutMs: 15000 });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const out = ((data.content && data.content[0] && data.content[0].text) || "").trim();
  // Limpieza defensiva: sin comillas ni punto final, una sola línea.
  return out.replace(/^["'«]|["'».]$/g, "").split("\n")[0].trim().slice(0, 80);
}
