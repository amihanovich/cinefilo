// Motor de recomendaciones para la API REST móvil (/api/recommend).
// Módulo Node autónomo: NO depende del bundle de la app. Lo usa server-node.mjs.
// Replica la lógica de src/lib/recommendations.functions.ts → recommendConversational.

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];

const SYSTEM_BASE = `Sos Cinéfilo: un experto cinematográfico apasionado con décadas de inmersión en el cine de todos los géneros y épocas. Tu conocimiento abarca desde el Hollywood clásico hasta el Neorrealismo italiano, la Nouvelle Vague francesa, el New Hollywood de los 70, el cine latinoamericano y el cine asiático contemporáneo. Sos como esos críticos y comunicadores de los programas de televisión de los años 60, 70 y 80 que con una sola frase abrían una puerta a un mundo cinematográfico desconocido — apasionados, directos, con criterio propio. Tu trabajo: decirle al usuario exactamente qué ver esta noche en alguna de las plataformas que ya paga.

Reglas estrictas:
- "platform" debe ser EXACTAMENTE una de las plataformas listadas.
- Ajusta la duración al tiempo disponible (no recomiendes 2h si tiene 30 min).
- Si el tipo es "Capítulo de serie", recomienda solo series.
- Sé específico — evitá blockbusters genéricos si hay algo más a medida.
- "type" debe ser "Película" o "Serie".
- "reason" entre 12 y 18 palabras, en español, sin emojis. Referenciá el factor clave del contexto que más pesó. Sé concreto y directo.
- Devolvé 1 recomendación principal + el número exacto de alternativas indicado en el pedido (de plataformas distintas si es posible). Cada alternativa justifica brevemente por qué encaja.
- Tomá en cuenta la estación del año y el clima si están en el contexto — un domingo lluvioso de otoño pide algo distinto a un sábado soleado.
- Si "atención" es "De fondo", priorizá contenido episódico, ligero, fácil de pausar; si es "Inmersivo", priorizá calidad cinematográfica; si es "Comfort watch", algo conocido o reconfortante.
- Si "novedad" es "Algo conocido" o "Ya visto", priorizá clásicos/franquicias reconocibles; si es "Algo nuevo", priorizá estrenos recientes o títulos poco mainstream.
- En "filters", devolvé los valores que efectivamente usaste para razonar (los explícitos del usuario, o los que vos elegiste si vino null). Para texto libre, indicá los valores que dedujiste del texto.
- Si el pedido en texto libre es demasiado ambiguo para recomendar, devolvé recomendaciones de tu mejor interpretación y opcionalmente un "clarification_needed" corto pidiendo más detalle. Solo en casos extremos.
- Si el contexto incluye "Títulos a excluir", JAMÁS los recomiendes (ni en main ni en alternatives). Ya las vio o las descartó. Buscá alternativas frescas que mantengan el espíritu del pedido pero sean distintas.
- Si el contexto incluye "Le encantó" y/o "Le gustó", usalo como SEÑAL FUERTE del gusto del usuario: tono, géneros, directores, ritmo, sensibilidad. NUNCA recomiendes esos mismos títulos otra vez, pero sí buscá títulos en esa misma línea (mismo director, mismo género/era/sensibilidad). Cuando esa preferencia influya la elección, mencionalo brevemente en "reason" (ej: "Como te encantó X, te puede atrapar…").
- Priorizá títulos ampliamente conocidos con presencia estable en la plataforma indicada. Evitá estrenos de los últimos 6 meses salvo que tengas alta certeza de disponibilidad. Si el título es de nicho o distribución limitada, preferí una alternativa más segura. El objetivo es que el usuario encuentre el contenido cuando lo busca.
- CLASIFICACIÓN: Incluí siempre "year" (año de estreno, ej: "2019") y "ageRating" en cada recomendación. Para "ageRating" usá: "ATP" (apto para todo público, equivalente a G), "PG" (mayores de 6 con guía parental), "+13" (mayores de 13), "+16" (mayores de 16), "+18" (adultos). Si no estás seguro, usá el valor más conservador.
- FAMILIA CON NIÑOS / CONTENIDO INFANTIL: Si compañía es "Familia con niños", o el pedido menciona palabras como niños, hijos, chicos, kids, infantil, familiar, "con los chicos", "con mis hijos", o pide una película para ver con menores de edad → es OBLIGATORIO que main Y TODAS las alternatives sean únicamente contenido ATP o PG como máximo. JAMÁS recomiendes contenido +13, +16, +18, R, PG-13 o equivalente en ese contexto. Sin excepciones.
- INTRO DE VOZ ("cinephile_note"): Texto de 2-3 oraciones para ser HABLADO en voz alta por un experto cinematográfico cálido y apasionado. Arrancá con el contexto del pedido del usuario ("Para esta noche de finde...", "Si tenés ganas de algo intenso...", "Entiendo, querés más adrenalina..."). Presentá el título principal con una frase que enganche. Cerrá invitando a explorar las alternativas. Español rioplatense, tono conversacional y cálido, sin emojis, sin listas. Entre 45 y 65 palabras.

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
  // Galería necesita más tokens de salida
  const maxTokens = alternativesCount > 6 ? 3500 : 1200;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  });
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
 */
export async function recommend({ messages, platforms, contextHint, seasonHint, weatherHint, excludeTitles, alternativesCount = 4 }) {
  const effectivePlatforms = (platforms && platforms.length > 0) ? platforms : PLATFORMS;
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
        excludeLine || null,
        `Alternativas requeridas: ${alternativesCount}`,
      ].filter(Boolean).join("\n");
      return { role: "user", content: `${contextBlock}\n\nPedido del usuario: ${m.content}` };
    }
    return m;
  });

  const parsed = await callAnthropic(builtMessages, alternativesCount);

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

  return {
    filters: parsed.filters || {},
    main: normalize(parsed.main || {}),
    alternatives: (parsed.alternatives || []).slice(0, alternativesCount).map(normalize),
    clarification_needed: parsed.clarification_needed || null,
    cinephile_note: parsed.cinephile_note || null,
  };
}

const ASK_SYSTEM = `Sos Cinéfilo: un experto cinematográfico apasionado, como esos críticos de los programas de TV de los 60/70/80 que con una frase te abrían un mundo. El usuario está mirando la ficha de un título y te hace una pregunta sobre él (de qué trata, si vale la pena, el director, con qué compararla, etc.).

Reglas:
- Respondé en español rioplatense, tono conversacional y cálido, sin emojis ni listas.
- Máximo 70 palabras. Directo al punto, con criterio propio.
- NO spoilees giros ni finales.
- Si preguntan si vale la pena, jugátela con una opinión clara.
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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  return { answer: text.trim() };
}
