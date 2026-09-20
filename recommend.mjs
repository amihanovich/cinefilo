import { fetchUpstream } from "./upstream.mjs";
import { validateItems, pickAvailable, detectPlatformMentions } from "./availability.mjs";

// Motor de recomendaciones para la API REST móvil (/api/recommend).
// Módulo Node autónomo: NO depende del bundle de la app. Lo usa server-node.mjs.
// Replica la lógica de src/lib/recommendations.functions.ts → recommendConversational.

// Sin Star+: murió en 2024 (fusionada con Disney+ en LatAm); dejarla acá hacía
// que Haiku siguiera asignándola y los clientes abrieran una app inexistente.
const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Universal+"];

// La persona es UNA y la comparten los tres prompts (el camino multi de la TV y
// el wizard, y los dos pasos del modo conversación). No repetirla.
const PERSONA = `Sos Miru: el experto de tu videoclub de confianza — un cinéfilo apasionado con décadas de inmersión en el cine de todos los géneros y épocas. Tu conocimiento abarca desde el Hollywood clásico hasta el Neorrealismo italiano, la Nouvelle Vague francesa, el New Hollywood de los 70, el cine latinoamericano y el cine asiático contemporáneo. Sos como esos críticos y comunicadores de los programas de televisión de los años 60, 70 y 80 que con una sola frase abrían una puerta a un mundo cinematográfico desconocido — apasionados, directos, con criterio propio.

Tu trabajo tiene dos caras inseparables:
1. Decirle al usuario exactamente qué ver esta noche en alguna de las plataformas que ya paga.
2. Hacerle entender POR QUÉ ESO y POR QUÉ A ÉL: cada recomendación se justifica conectándola explícitamente con lo que pidió, su momento o su gusto conocido. Nunca recomendás "porque es buena": recomendás porque encaja con ESTE pedido de ESTA persona. Cuando viene al caso, sumás un dato de cinéfilo (el director, la época, una conexión con otra obra) que enriquezca la elección — como el experto del videoclub que además de elegirte la película te contaba por qué era especial.`;

const SYSTEM_BASE = `${PERSONA}

Reglas estrictas:
- "platform" debe ser EXACTAMENTE una de las plataformas listadas.
- Ajusta la duración al tiempo disponible (no recomiendes 2h si tiene 30 min).
- Si el tipo es "Capítulo de serie", recomienda solo series.
- Sé específico — evitá blockbusters genéricos si hay algo más a medida.
- "type" debe ser "Película" o "Serie".
- "synopsis" entre 20 y 30 palabras, en español, sin emojis: DE QUÉ VA (planteo y qué está en juego), sin spoilers. Es lo que el usuario lee para saber si le interesa la historia.
- "reason" entre 12 y 18 palabras, en español, sin emojis. Es EL PORQUÉ y es sagrado: conectala explícitamente con lo que el usuario pidió o con su gusto conocido — idealmente arrancando con "Porque..." (ej: "Porque pediste tensión y acá cada plano la respira"). Concreta y visual. Prohibido lo genérico ("gran película", "muy recomendable", "imperdible").
- "hook": la versión corta para las tarjetas chicas, donde entra UNA sola línea. Frase de 16 a 22 palabras que junta las dos cosas: primero DE QUÉ VA (5 a 8 palabras) y después POR QUÉ se la recomendás, separados por " · ", sin punto final. Ejemplo: "Dos estafadores y un negocio que se les escapa · te la propongo por el guion que no falla nunca".
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
  const altItem = `{"title":"","platform":"","duration":"","type":"","year":"","ageRating":"","synopsis":"","hook":"","reason":""}`;
  const altsArray = Array.from({ length: alternativesCount }, () => altItem).join(",");
  const format = `\n\nFORMATO DE SALIDA: Devolvé ÚNICAMENTE JSON válido con esta forma exacta, sin markdown, sin texto extra:\n{"filters":{"time":"","company":"","mood":"","type":"","attention":"","novelty":""},"main":{"title":"","platform":"","duration":"","type":"","year":"","ageRating":"","synopsis":"","hook":"","reason":""},"alternatives":[${altsArray}],"clarification_needed":null,"cinephile_note":""}`;
  return SYSTEM_BASE + format;
}

// Una llamada a Haiku que devuelve JSON (tolerante a ```json y a texto alrededor).
async function callJson({ system, messages, maxTokens, timeoutMs = 40000 }) {
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
      max_tokens: maxTokens,
      system,
      messages,
    }),
  }, { timeoutMs });
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

async function callAnthropic(messages, alternativesCount = 4) {
  // Galería necesita más tokens de salida. Cada ítem ahora trae también
  // synopsis + hook (~45 palabras extra c/u), así que el techo sube: si el JSON
  // se trunca, la respuesta entera se pierde.
  const maxTokens = alternativesCount > 6 ? 5500 : 2600;
  return callJson({ system: buildSystem(alternativesCount), messages, maxTokens });
}

/**
 * @param {object} params
 * @param {{ role: "user"|"assistant", content: string }[]} params.messages - conversation history
 * @param {string[]} params.platforms
 * @param {string|null} params.contextHint
 * @param {string|null} params.seasonHint
 * @param {string|null} params.weatherHint
 * @param {string[]} params.excludeTitles
 * @param {number} [params.alternativesCount=4] - 0 = modo conversación (una sola película)
 * @param {string} [params.country] - ISO2 del usuario (default región del server)
 * @param {string|null} [params.tasteProfile] - perfil de gusto del dispositivo (texto, ya formateado)
 * @param {{title:string, reason:string|null}[]} [params.rejected] - descartes de ESTA charla
 */
export async function recommend({ messages, platforms, contextHint, seasonHint, weatherHint, excludeTitles, alternativesCount = 4, country, tasteProfile = null, rejected = [] }) {
  // Si el pedido de ESTE turno nombra una plataforma explícita ("buscame algo
  // en Netflix", "para ver en Disney"), eso PISA el preset de plataformas del
  // perfil — solo para este pedido puntual, no para toda la conversación.
  const lastUserQuery = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const mentioned = detectPlatformMentions(lastUserQuery);
  const effectivePlatforms = mentioned.length ? mentioned : ((platforms && platforms.length > 0) ? platforms : PLATFORMS);
  const validationPlatforms = mentioned.length ? mentioned : ((platforms && platforms.length) ? platforms : null);
  const envParts = [];
  if (seasonHint) envParts.push(`Estación: ${seasonHint}`);
  if (weatherHint) envParts.push(`Clima: ${weatherHint}`);
  const envLine = envParts.length ? `\nContexto ambiental: ${envParts.join(" · ")}` : "";
  const baseContext = [
    contextHint ? `Contexto temporal: ${contextHint}` : null,
    envLine || null,
    `Plataformas disponibles: ${effectivePlatforms.join(", ")}`,
    country ? `País del usuario: ${country} (recomendá solo títulos en el catálogo local)` : null,
  ].filter(Boolean);

  // Modo conversación (la app móvil): UNA película, elegida y escrita en dos
  // pasos con la verificación de catálogo en el medio.
  if (alternativesCount === 0) {
    return recommendSingle({ messages, baseContext, validationPlatforms, country, excludeTitles, tasteProfile, rejected });
  }

  // Se piden 2 alternativas de margen: la validación de disponibilidad (TMDB,
  // por país) puede descartar títulos, y así igual se llega al count pedido.
  const askCount = alternativesCount + 2;
  const builtMessages = injectContext(messages, [
    ...baseContext,
    excludeLine(excludeTitles),
    `Alternativas requeridas: ${askCount}`,
  ]);

  const parsed = await callAnthropic(builtMessages, askCount);

  let main = normalize(parsed.main || {});
  let alternatives = (parsed.alternatives || []).slice(0, askCount).map(normalize);
  let cinephileNote = parsed.cinephile_note || null;

  // Disponibilidad real: confirma/corrige plataformas y separa lo que no está.
  // El main solo se reemplaza si quedó confirmado como NO disponible ("unknown"
  // se deja pasar: nunca peor que hoy) — y en ese caso se regenera la intro de
  // voz, que lo presenta por nombre.
  await validateItems([main, ...alternatives], validationPlatforms, country);
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

// Normaliza un ítem tal como viene del modelo (strings garantizados).
function normalize(r) {
  return {
    title: String(r.title || ""),
    platform: String(r.platform || ""),
    duration: String(r.duration || ""),
    type: String(r.type || ""),
    year: r.year ? String(r.year) : undefined,
    ageRating: r.ageRating ? String(r.ageRating) : undefined,
    synopsis: r.synopsis ? String(r.synopsis) : undefined,
    hook: r.hook ? String(r.hook) : undefined,
    reason: String(r.reason || ""),
  };
}

function excludeLine(excludeTitles) {
  return excludeTitles && excludeTitles.length > 0
    ? `Títulos a excluir (ya vistos o mostrados — NO los recomiendes):\n- ${excludeTitles.join("\n- ")}`
    : null;
}

// El contexto va inyectado en el PRIMER mensaje del usuario (la conversación
// sigue siendo multi-turno: el modelo ve el hilo entero).
function injectContext(messages, lines) {
  const block = lines.filter(Boolean).join("\n");
  return messages.map((m, i) =>
    i === 0 && m.role === "user"
      ? { role: "user", content: `${block}\n\nPedido del usuario: ${m.content}` }
      : m,
  );
}

// ── Modo conversación: propone → verifica → pitchea ──────────────────────────
// Antes se pedía una película con el porqué ya escrito y se validaba después:
// si no estaba, se promovía un respaldo y se regeneraba el texto. Ahora el
// modelo primero ELIGE (6 candidatos rankeados, baratos), el catálogo real
// decide cuál queda, y recién entonces se escribe la carta — sabiendo que la
// película existe y dónde. La carta es lo único que la persona lee: por eso va
// en un paso propio, con el perfil de gusto y los descartes de la charla a la
// vista, y la regla de nombrar UNA señal suya cuando influyó ("cómo supo").

const SYSTEM_PROPOSE = `${PERSONA}

Estás en una CONVERSACIÓN y en este paso tu tarea es ELEGIR, no escribir: proponé 6 candidatos ordenados del que mejor encaja al que menos, para que un verificador de catálogo se quede con el primero que de verdad esté disponible en el país del usuario. La carta del elegido la escribís después, en otro paso.

Reglas:
- 6 títulos DISTINTOS entre sí (no seis variaciones de lo mismo): los primeros 3 apuntan al centro del pedido; el 4 y el 5 abren un poco (otra época, otro país, otro tono compatible); el 6 es una apuesta que el perfil no pediría pero que vos jugarías — decilo en su "line".
- "platform" EXACTAMENTE una de las plataformas listadas. "type": "Película" o "Serie". "year" obligatorio (ej. "2014").
- Si el pedido nombra un título o un director, es LA BRÚJULA: buscá por su ADN (época, tono, ritmo, puesta en escena), no por género a secas.
- Si hay "Perfil de gusto", es una señal FUERTE: rankeá por encaje con ESTA persona, no con el público general. Pero el pedido de HOY manda sobre el perfil: si hoy pide algo distinto a lo de siempre, seguilo.
- "Descartes en esta charla" con motivo: ese motivo es una restricción dura para TODOS los candidatos. Si hay 2 o más descartes seguidos SIN motivo, la persona no sabe decir qué no le cierra: elegí candidatos en CONTRASTE claro con lo descartado y completá "clarification_needed" con UNA pregunta corta y cálida que lo destrabe.
- Pedido ambiguo o con duda (muletillas transcriptas, "no sé", "lo que sea", frases inconclusas): proponé igual tu mejor lectura Y completá "clarification_needed" (máximo 20 palabras, cálida, una sola). Si el pedido es claro, null.
- Títulos a excluir: JAMÁS los propongas.
- Familia con niños, o cualquier mención de menores: SOLO contenido ATP o PG. Sin excepciones.
- Ajustá la duración al tiempo disponible; "Capítulo de serie" = solo series.
- Priorizá títulos con presencia estable en la plataforma; evitá estrenos de los últimos 6 meses salvo certeza.
- "line": 10 a 14 palabras, español rioplatense, sin emojis: por qué ESTE para ESTA persona.

FORMATO DE SALIDA: JSON válido y nada más:
{"candidates":[{"title":"","platform":"","type":"","year":"","line":""},{"title":"","platform":"","type":"","year":"","line":""},{"title":"","platform":"","type":"","year":"","line":""},{"title":"","platform":"","type":"","year":"","line":""},{"title":"","platform":"","type":"","year":"","line":""},{"title":"","platform":"","type":"","year":"","line":""}],"clarification_needed":null}`;

const SYSTEM_PITCH = `${PERSONA}

Ya elegiste la película y el catálogo confirmó dónde está. Ahora escribí la carta: es lo único que la persona va a leer, y es por lo que existe Miru.

Devolvé JSON válido y nada más:
{"synopsis":"","reason":"","cinephile_note":"","duration":"","ageRating":""}

- "synopsis": 20 a 30 palabras, DE QUÉ VA (planteo y qué está en juego), sin spoilers, sin emojis.
- "reason": 2 a 4 oraciones (45 a 75 palabras), español rioplatense, sin emojis ni listas. Arrancá por el porqué atado a lo que pidió HOY; seguí con qué la hace especial (quién la dirigió y qué más hizo, la época o el movimiento, con qué obra dialoga, una decisión de puesta en escena); cerrá con qué se va a llevar si la ve. Nada genérico ("gran película", "imperdible", "muy recomendable"). Sin spoilers.
- LA CARTA: si el "Perfil de gusto" o un descarte de esta charla influyeron en la elección, NOMBRÁ UNA sola señal concreta de esa persona, como quien se acuerda ("como la última vez te fuiste con X…", "como dijiste que la anterior era muy larga…", "como te tira el cine de los 70…"). Una, y VERDADERA: nunca inventes lo que no está en el contexto, y nunca más de una — una es "cómo supo", tres es incómodo. Si nada influyó, no fuerces nada.
- "cinephile_note": 2 a 3 oraciones (45 a 65 palabras) para ser HABLADAS en voz alta: arrancá con el contexto del pedido ("Para esta noche de finde…"), presentá el título con una frase que enganche y deje claro por qué responde al pedido, y cerrá invitando a verla o a pedirte otra si no le cierra. Sin emojis ni listas.
- "duration": ej. "1h 52m" o "8 capítulos de 45m". "ageRating": "ATP", "PG", "+13", "+16" o "+18" (el más conservador si dudás).`;

const CANDIDATES = 6;

function normalizeCandidate(c) {
  return {
    title: String(c.title || "").trim(),
    platform: String(c.platform || "").trim(),
    type: /serie/i.test(String(c.type || "")) ? "Serie" : "Película",
    year: c.year ? String(c.year).slice(0, 4) : undefined,
    line: String(c.line || "").trim(),
  };
}

function formatRejected(rejected) {
  if (!rejected || !rejected.length) return null;
  const items = rejected.slice(-6).map((r) => `- ${r.title}${r.reason ? ` — dijo: "${r.reason}"` : " — sin motivo"}`);
  let dry = 0;
  for (let i = rejected.length - 1; i >= 0 && !rejected[i].reason; i--) dry++;
  const tail = dry >= 2 ? `\n(${dry} descartes seguidos sin motivo: elegí en contraste y preguntá qué no cierra)` : "";
  return `Descartes en esta charla (más viejo primero):\n${items.join("\n")}${tail}`;
}

async function proposeCandidates({ messages, contextLines }) {
  const parsed = await callJson({
    system: SYSTEM_PROPOSE,
    messages: injectContext(messages, contextLines),
    maxTokens: 700,
    timeoutMs: 25000,
  });
  const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
    .map(normalizeCandidate)
    .filter((c) => c.title)
    .slice(0, CANDIDATES);
  return { candidates, clarification: typeof parsed.clarification_needed === "string" && parsed.clarification_needed.trim() ? parsed.clarification_needed.trim() : null };
}

// El primero disponible según el ranking del modelo; "unknown" (TMDB no lo
// resolvió) va después de los confirmados y antes que nada — nunca peor que hoy.
function pickWinner(candidates) {
  const ok = candidates.find((c) => c._avail === "confirmed" || c._avail === "corrected");
  if (ok) return ok;
  return candidates.find((c) => c._avail === "unknown" || c._avail === undefined) || null;
}

async function recommendSingle({ messages, baseContext, validationPlatforms, country, excludeTitles, tasteProfile, rejected }) {
  const t0 = Date.now();
  const profileBlock = tasteProfile && String(tasteProfile).trim()
    ? `Perfil de gusto (lo que Miru sabe de esta persona por su historial en el dispositivo):\n${String(tasteProfile).trim().slice(0, 1500)}`
    : null;
  const rejectedBlock = formatRejected(rejected);
  const exclude = [...(excludeTitles || [])];

  // 1) Proponer. Si NINGÚN candidato está en el país, un solo reintento con
  //    esos títulos excluidos; después, degradar suave (como siempre).
  let proposed = await proposeCandidates({ messages, contextLines: [...baseContext, profileBlock, rejectedBlock, excludeLine(exclude)] });
  let candidates = proposed.candidates;
  const tProp = Date.now();
  await validateItems(candidates, validationPlatforms, country);
  let winner = pickWinner(candidates);
  let retried = false;
  if (!winner && candidates.length) {
    retried = true;
    const again = await proposeCandidates({
      messages,
      contextLines: [...baseContext, profileBlock, rejectedBlock, excludeLine([...exclude, ...candidates.map((c) => c.title)]), "Los candidatos anteriores NO están disponibles en el país del usuario: proponé otros."],
    });
    if (again.candidates.length) {
      candidates = again.candidates;
      if (!proposed.clarification && again.clarification) proposed = { ...proposed, clarification: again.clarification };
      await validateItems(candidates, validationPlatforms, country);
      winner = pickWinner(candidates);
    }
  }
  if (!winner) winner = candidates[0] || null;
  if (!winner) throw new Error("El modelo no propuso candidatos.");
  const tTmdb = Date.now();
  const avail = winner._avail || "unknown";
  const pickedRank = candidates.indexOf(winner) + 1;
  for (const c of candidates) delete c._avail;

  // 2) La carta, con la película ya confirmada. Sigue la conversación (el
  //    modelo ve el hilo) y recibe el perfil y los descartes para poder citar
  //    UNA señal. Si esta llamada falla, se cae a la "line" del paso 1: la
  //    persona igual recibe la película, con un porqué corto.
  const pitchMessages = [
    ...injectContext(messages, [...baseContext, profileBlock, rejectedBlock]),
    {
      role: "user",
      content: `Película elegida y confirmada: "${winner.title}" (${winner.year || "s/f"}, ${winner.type}) en ${winner.platform}. Tu nota de elección: ${winner.line || "-"}. Escribí la carta.`,
    },
  ];
  // El hilo tiene que terminar en un turno de usuario y alternar roles: si el
  // último mensaje del historial ya era del usuario, se fusionan.
  const merged = mergeTrailingUser(pitchMessages);
  let pitch = null;
  try {
    pitch = await callJson({ system: SYSTEM_PITCH, messages: merged, maxTokens: 650, timeoutMs: 25000 });
  } catch (e) {
    console.warn("[recommend] la carta falló, va con la line del paso 1:", e.message);
  }
  const tPitch = Date.now();
  console.log(`[metrics-single] ${JSON.stringify({ propose_ms: tProp - t0, tmdb_ms: tTmdb - tProp, pitch_ms: tPitch - tTmdb, retried, picked_rank: pickedRank, avail, profile: !!profileBlock, rejected: (rejected || []).length })}`);

  const main = {
    title: winner.title,
    platform: winner.platform,
    duration: String((pitch && pitch.duration) || ""),
    type: winner.type,
    year: winner.year,
    ageRating: pitch && pitch.ageRating ? String(pitch.ageRating) : undefined,
    synopsis: pitch && pitch.synopsis ? String(pitch.synopsis) : undefined,
    reason: String((pitch && pitch.reason) || winner.line || ""),
    posterUrl: winner.posterUrl || undefined,
    backdropUrl: winner.backdropUrl || undefined,
  };
  return {
    filters: {},
    main,
    alternatives: [],
    clarification_needed: proposed.clarification,
    cinephile_note: pitch && pitch.cinephile_note ? String(pitch.cinephile_note) : null,
  };
}

function mergeTrailingUser(messages) {
  const out = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) out[out.length - 1] = { role: m.role, content: `${prev.content}\n\n${m.content}` };
    else out.push({ role: m.role, content: m.content });
  }
  return out;
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
        "Sos Miru, experto cálido de videoclub. Devolvé SOLO un texto de 2-3 oraciones (45-65 palabras, español rioplatense, sin emojis ni listas) para ser HABLADO: arrancá con el contexto del pedido, presentá el título indicado con una frase que enganche y deje claro POR QUÉ responde al pedido, y cerrá invitando a mirar las alternativas.",
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

const ASK_SYSTEM = `Sos Miru: el experto de tu videoclub de confianza — un cinéfilo apasionado, como esos críticos de los programas de TV de los 60/70/80 que con una frase te abrían un mundo. El usuario está mirando la ficha de un título y te hace una pregunta sobre él (de qué trata, si vale la pena, el director, con qué compararla, etc.).

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

const ORB_SYSTEM = `Sos Miru: el experto de tu videoclub de confianza — un cinéfilo apasionado, como esos críticos de los programas de TV de los 60/70/80 que con una frase te abrían un mundo. El usuario está mirando la ficha de un título y te habla por voz. Puede querer dos cosas:
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
  "Sos Miru. Te llega el pedido en lenguaje libre de un usuario que quiere ver algo (peli o serie). " +
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
