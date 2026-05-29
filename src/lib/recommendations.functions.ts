import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createAiProvider } from "./ai-gateway";
import { getOptionalUser } from "@/lib/auth-optional";
import { getTasteSnapshot, type TasteSnapshot } from "./feedback.functions";

const recSchema = z.object({
  title: z.string(),
  platform: z.string(),
  duration: z.string(),
  type: z.string(),
  reason: z.string(),
});

const filtersOutSchema = z.object({
  time: z.string().nullable(),
  company: z.string().nullable(),
  mood: z.string().nullable(),
  type: z.string().nullable(),
  attention: z.string().nullable().optional().default(null),
  novelty: z.string().nullable().optional().default(null),
});

const resultSchema = z.object({
  filters: filtersOutSchema,
  main: recSchema,
  alternatives: z.array(recSchema).length(2),
  clarification_needed: z.string().nullable().optional(),
});

const SYSTEM_BASE = `Eres un experto recomendador de streaming en español. Tu trabajo: en máximo 90 segundos, decirle al usuario exactamente qué ver esta noche en alguna de las plataformas que ya paga.

Reglas estrictas:
- "platform" debe ser EXACTAMENTE una de las plataformas listadas.
- Ajusta la duración al tiempo disponible (no recomiendes 2h si tiene 30 min).
- Si el tipo es "Capítulo de serie", recomienda solo series.
- Sé específico — evita blockbusters genéricos si hay algo más a medida.
- "type" debe ser "Película" o "Serie".
- "reason" entre 25 y 45 palabras, en español, sin emojis. DEBE referenciar explícitamente 2 o 3 de las variables del contexto que más pesaron en la elección (ej: "Para un martes a las 23h, con clima nublado y eligiendo 'de fondo'…"). Sé concreto, no abstracto.
- Devuelve 1 recomendación principal + 2 alternativas distintas entre sí (idealmente de plataformas distintas si es posible). Cada alternativa también debe justificar por qué encaja, idealmente atacando un ángulo distinto del contexto que la principal.
- Tomá en cuenta la estación del año y el clima si están en el contexto — un domingo lluvioso de otoño pide algo distinto a un sábado soleado.
- Si "atención" es "De fondo", priorizá contenido episódico, ligero, fácil de pausar; si es "Inmersivo", priorizá calidad cinematográfica; si es "Comfort watch", algo conocido o reconfortante.
- Si "novedad" es "Algo conocido" o "Ya visto", priorizá clásicos/franquicias reconocibles; si es "Algo nuevo", priorizá estrenos recientes o títulos poco mainstream.
- En "filters", devuelve los valores que efectivamente usaste para razonar (los explícitos del usuario, o los que tú elegiste si vino null). Para texto libre, indica los valores que dedujiste del texto.
- Si el pedido en texto libre es demasiado ambiguo para recomendar, devuelve recomendaciones de tu mejor interpretación y opcionalmente un "clarification_needed" corto pidiendo más detalle. Solo en casos extremos.
- Si el contexto incluye "Títulos a excluir", JAMÁS los recomiendes (ni en main ni en alternatives). Ya las vio o las descartó. Buscá alternativas frescas que mantengan el espíritu del pedido pero sean distintas.
- Si el contexto incluye "Le encantó" y/o "Le gustó", usalo como SEÑAL FUERTE del gusto del usuario: tono, géneros, directores, ritmo, sensibilidad. NUNCA recomiendes esos mismos títulos otra vez, pero sí buscá títulos en esa misma línea (mismo director, mismo género/era/sensibilidad). Cuando esa preferencia influya la elección, mencionalo brevemente en "reason" (ej: "Como te encantó X, te puede atrapar…").
- Priorizá títulos ampliamente conocidos con presencia estable en la plataforma indicada. Evitá estrenos de los últimos 6 meses salvo que tengas alta certeza de disponibilidad. Si el título es de nicho o distribución limitada, preferí una alternativa más segura. El objetivo es que el usuario encuentre el contenido cuando lo busca.

FORMATO DE SALIDA: Devuelve ÚNICAMENTE JSON válido con esta forma exacta, sin markdown, sin texto extra:
{"filters":{"time":"","company":"","mood":"","type":"","attention":"","novelty":""},"main":{"title":"","platform":"","duration":"","type":"","reason":""},"alternatives":[{"title":"","platform":"","duration":"","type":"","reason":""},{"title":"","platform":"","duration":"","type":"","reason":""}],"clarification_needed":null}`;

function parseAiJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonStr =
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
  return schema.parse(JSON.parse(jsonStr));
}

function mapErr(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[recommendations] AI gateway error:", message);
  return new Error(
    message.includes("429")
      ? "Demasiadas peticiones. Espera un momento e inténtalo otra vez."
      : message.includes("402")
        ? "Se acabaron los créditos de IA. Añade créditos en Ajustes."
        : "No pudimos generar la recomendación. Inténtalo otra vez.",
  );
}

async function logHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  row: {
    source: "text" | "filters" | "moment";
    prompt_text: string | null;
    time: string | null;
    company: string | null;
    mood: string | null;
    type: string | null;
    attention?: string | null;
    novelty?: string | null;
    season?: string | null;
    weather?: string | null;
    platforms: string[];
  },
) {
  await supabase.from("search_history").insert({
    user_id: userId,
    source: row.source,
    prompt_text: row.prompt_text,
    time_filter: row.time,
    company_filter: row.company,
    mood_filter: row.mood,
    type_filter: row.type,
    attention_filter: row.attention ?? null,
    novelty_filter: row.novelty ?? null,
    season_hint: row.season ?? null,
    weather_hint: row.weather ?? null,
    platforms: row.platforms,
  });
}

/* ---------- recommendFromFilters ---------- */

const filtersInputSchema = z.object({
  time: z.string().nullable(),
  company: z.string().nullable(),
  mood: z.string().nullable(),
  type: z.string().nullable(),
  attention: z.string().nullable().optional(),
  novelty: z.string().nullable().optional(),
  platforms: z.array(z.string().min(1)).min(1).max(10),
  contextHint: z.string().min(1).max(400),
  seasonHint: z.string().max(80).optional().nullable(),
  weatherHint: z.string().max(120).optional().nullable(),
  source: z.enum(["filters", "moment"]).default("filters"),
  extraText: z.string().max(500).optional().nullable(),
  excludeTitles: z.array(z.string().min(1).max(200)).max(40).optional().default([]),
  profileSeed: z
    .object({
      ageBracket: z.string().min(1).max(20).optional(),
      lovedTitles: z.array(z.string().min(1).max(120)).max(8).optional(),
    })
    .optional()
    .nullable(),
});

function buildTasteLine(taste: TasteSnapshot | null): string {
  if (!taste) return "";
  const parts: string[] = [];
  if (taste.loved.length > 0) parts.push(`Le encantó (señal fuerte): ${taste.loved.join(", ")}`);
  if (taste.liked.length > 0) parts.push(`Le gustó: ${taste.liked.join(", ")}`);
  if (taste.disliked.length > 0)
    parts.push(`NO le gustó (señal negativa fuerte — evitá títulos similares en tono/género/director): ${taste.disliked.join(", ")}`);
  return parts.length ? `\n\nGusto del usuario:\n- ${parts.join("\n- ")}` : "";
}

function buildProfileSeedLine(
  seed: { ageBracket?: string; lovedTitles?: string[] } | null | undefined,
): string {
  if (!seed) return "";
  const parts: string[] = [];
  if (seed.ageBracket) parts.push(`Rango de edad: ${seed.ageBracket}`);
  if (seed.lovedTitles && seed.lovedTitles.length > 0) {
    parts.push(
      `Títulos que el usuario declaró amar (úsalos como ancla de sensibilidad — NUNCA los recomiendes de nuevo, pero buscá títulos en esa línea): ${seed.lovedTitles.join(", ")}`,
    );
  }
  return parts.length ? `\n\nPerfil estable del usuario:\n- ${parts.join("\n- ")}` : "";
}

export const recommendFromFilters = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => filtersInputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");

    const provider = createAiProvider(apiKey);
    const model = provider("claude-haiku-4-5-20251001");

    const fmt = (v: string | null) => (v ?? "Elegí por mí (decide tú)");

    const extra = data.extraText?.trim()
      ? `\n\nAdemás, el usuario añadió este matiz en texto libre (combinalo con los filtros):\n"""\n${data.extraText.trim()}\n"""`
      : "";

    const envParts: string[] = [];
    if (data.seasonHint) envParts.push(`Estación: ${data.seasonHint}`);
    if (data.weatherHint) envParts.push(`Clima: ${data.weatherHint}`);
    const envLine = envParts.length ? `\nContexto ambiental: ${envParts.join(" · ")}` : "";

    const user = await getOptionalUser();
    const taste = user ? await getTasteSnapshot(user.supabase, user.userId) : null;
    const tasteLine = buildTasteLine(taste);

    // Si el usuario está logueado y no nos mandaron seed desde el cliente,
    // levantamos su perfil persistido (age_bracket + seed_loved).
    let effectiveSeed = data.profileSeed ?? null;
    if (user && !effectiveSeed) {
      const { data: prof } = await user.supabase
        .from("profiles")
        .select("age_bracket, seed_loved")
        .eq("id", user.userId)
        .maybeSingle();
      if (prof?.age_bracket || (prof?.seed_loved && prof.seed_loved.length > 0)) {
        effectiveSeed = {
          ageBracket: prof.age_bracket ?? undefined,
          lovedTitles: (prof.seed_loved ?? []) as string[],
        };
      }
    }
    const seedLine = buildProfileSeedLine(effectiveSeed);

    // Combinamos excluded explícitos + títulos ya vistos en el historial de feedback
    // + los lovedTitles del seed (para no re-recomendarlos).
    const exclSet = new Set<string>([
      ...(data.excludeTitles ?? []),
      ...(taste?.seen ?? []),
      ...(taste?.loved ?? []),
      ...(taste?.liked ?? []),
      ...(taste?.disliked ?? []),
      ...(effectiveSeed?.lovedTitles ?? []),
    ]);
    const excluded = [...exclSet];
    const excludeLine =
      excluded.length > 0
        ? `\n\nTítulos a excluir (ya vistos o declarados como favoritos — NO los recomiendes):\n- ${excluded.join("\n- ")}`
        : "";

    const prompt = `${SYSTEM_BASE}

Contexto temporal: ${data.contextHint}${envLine}

Pedido del usuario (filtros):
- Tiempo disponible: ${fmt(data.time)}
- Compañía: ${fmt(data.company)}
- Mood: ${fmt(data.mood)}
- Tipo: ${fmt(data.type)}
- Atención: ${fmt(data.attention ?? null)}
- Novedad: ${fmt(data.novelty ?? null)}
- Plataformas disponibles: ${data.platforms.join(", ")}${extra}${tasteLine}${seedLine}${excludeLine}


Recuerda: "platform" debe ser EXACTAMENTE una de: ${data.platforms.join(", ")}.`;

    try {
      const { text } = await generateText({ model, prompt });
      const result = parseAiJson(text, resultSchema);
      if (user) {
        await logHistory(user.supabase, user.userId, {
          source: data.source,
          prompt_text: null,
          time: result.filters.time,
          company: result.filters.company,
          mood: result.filters.mood,
          type: result.filters.type,
          attention: result.filters.attention ?? data.attention ?? null,
          novelty: result.filters.novelty ?? data.novelty ?? null,
          season: data.seasonHint ?? null,
          weather: data.weatherHint ?? null,
          platforms: data.platforms,
        });
      }
      return result;
    } catch (err) {
      throw mapErr(err);
    }
  });

/* ---------- recommendFromText ---------- */

const textInputSchema = z.object({
  text: z.string().min(3).max(500),
  platforms: z.array(z.string().min(1)).min(1).max(10),
  contextHint: z.string().min(1).max(400),
  seasonHint: z.string().max(80).optional().nullable(),
  weatherHint: z.string().max(120).optional().nullable(),
  excludeTitles: z.array(z.string().min(1).max(200)).max(40).optional().default([]),
  profileSeed: z
    .object({
      ageBracket: z.string().min(1).max(20).optional(),
      lovedTitles: z.array(z.string().min(1).max(120)).max(8).optional(),
    })
    .optional()
    .nullable(),
});

export const recommendFromText = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => textInputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");

    const provider = createAiProvider(apiKey);
    const model = provider("claude-haiku-4-5-20251001");

    const envParts: string[] = [];
    if (data.seasonHint) envParts.push(`Estación: ${data.seasonHint}`);
    if (data.weatherHint) envParts.push(`Clima: ${data.weatherHint}`);
    const envLine = envParts.length ? `\nContexto ambiental: ${envParts.join(" · ")}` : "";

    const user = await getOptionalUser();
    const taste = user ? await getTasteSnapshot(user.supabase, user.userId) : null;
    const tasteLine = buildTasteLine(taste);

    let effectiveSeed = data.profileSeed ?? null;
    if (user && !effectiveSeed) {
      const { data: prof } = await user.supabase
        .from("profiles")
        .select("age_bracket, seed_loved")
        .eq("id", user.userId)
        .maybeSingle();
      if (prof?.age_bracket || (prof?.seed_loved && prof.seed_loved.length > 0)) {
        effectiveSeed = {
          ageBracket: prof.age_bracket ?? undefined,
          lovedTitles: (prof.seed_loved ?? []) as string[],
        };
      }
    }
    const seedLine = buildProfileSeedLine(effectiveSeed);

    const exclSet = new Set<string>([
      ...(data.excludeTitles ?? []),
      ...(taste?.seen ?? []),
      ...(taste?.loved ?? []),
      ...(taste?.liked ?? []),
      ...(taste?.disliked ?? []),
      ...(effectiveSeed?.lovedTitles ?? []),
    ]);
    const excluded = [...exclSet];
    const excludeLine =
      excluded.length > 0
        ? `\n\nTítulos a excluir (ya vistos o declarados como favoritos — NO los recomiendes):\n- ${excluded.join("\n- ")}`
        : "";

    const prompt = `${SYSTEM_BASE}

Contexto temporal: ${data.contextHint}${envLine}

Plataformas disponibles del usuario: ${data.platforms.join(", ")}

El usuario describió libremente lo que quiere ver:
"""
${data.text}
"""${tasteLine}${seedLine}${excludeLine}

Tu tarea:
1. Inferir del texto: tiempo aproximado, compañía, mood, tipo, nivel de atención y novedad. Si algo no está claro, deducí lo más razonable según el contexto.
2. Recomendá basándote en esa inferencia + contexto ambiental.
3. En "filters", devolvé los valores que dedujiste (catálogo: tiempo "30 min"|"1 hora"|"1.5 horas"|"Noche entera"; tipo "Película"|"Serie"|"Capítulo de serie"; atención "Inmersivo"|"De fondo"|"Comfort watch"; novedad "Algo nuevo"|"Algo conocido"|"Ya visto (rever)").
4. "platform" debe ser EXACTAMENTE una de: ${data.platforms.join(", ")}.`;

    try {
      const { text } = await generateText({ model, prompt });
      const result = parseAiJson(text, resultSchema);
      if (user) {
        await logHistory(user.supabase, user.userId, {
          source: "text",
          prompt_text: data.text,
          time: result.filters.time,
          company: result.filters.company,
          mood: result.filters.mood,
          type: result.filters.type,
          attention: result.filters.attention ?? null,
          novelty: result.filters.novelty ?? null,
          season: data.seasonHint ?? null,
          weather: data.weatherHint ?? null,
          platforms: data.platforms,
        });
      }
      return result;
    } catch (err) {
      throw mapErr(err);
    }
  });

/* ---------- recommendConversational (multi-turn chat) ---------- */

const conversationalInputSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1)
    .max(20),
  platforms: z.array(z.string().min(1)).min(1).max(10),
  contextHint: z.string().min(1).max(400),
  seasonHint: z.string().max(80).optional().nullable(),
  weatherHint: z.string().max(120).optional().nullable(),
  excludeTitles: z.array(z.string().min(1).max(200)).max(60).optional().default([]),
  profileSeed: z
    .object({
      ageBracket: z.string().min(1).max(20).optional(),
      lovedTitles: z.array(z.string().min(1).max(120)).max(8).optional(),
    })
    .optional()
    .nullable(),
});

export const recommendConversational = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => conversationalInputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");

    const provider = createAiProvider(apiKey);
    const model = provider("claude-haiku-4-5-20251001");

    const envParts: string[] = [];
    if (data.seasonHint) envParts.push(`Estación: ${data.seasonHint}`);
    if (data.weatherHint) envParts.push(`Clima: ${data.weatherHint}`);
    const envLine = envParts.length ? `\nContexto ambiental: ${envParts.join(" · ")}` : "";

    const user = await getOptionalUser();
    const taste = user ? await getTasteSnapshot(user.supabase, user.userId) : null;
    const tasteLine = buildTasteLine(taste);

    let effectiveSeed = data.profileSeed ?? null;
    if (user && !effectiveSeed) {
      const { data: prof } = await user.supabase
        .from("profiles")
        .select("age_bracket, seed_loved")
        .eq("id", user.userId)
        .maybeSingle();
      if (prof?.age_bracket || (prof?.seed_loved && prof.seed_loved.length > 0)) {
        effectiveSeed = {
          ageBracket: prof.age_bracket ?? undefined,
          lovedTitles: (prof.seed_loved ?? []) as string[],
        };
      }
    }
    const seedLine = buildProfileSeedLine(effectiveSeed);

    const exclSet = new Set<string>([
      ...(data.excludeTitles ?? []),
      ...(taste?.seen ?? []),
      ...(taste?.loved ?? []),
      ...(taste?.liked ?? []),
      ...(taste?.disliked ?? []),
      ...(effectiveSeed?.lovedTitles ?? []),
    ]);
    const excluded = [...exclSet];
    const excludeLine =
      excluded.length > 0
        ? `\n\nTítulos a excluir (ya vistos o recomendados antes — NO los repitas):\n- ${excluded.join("\n- ")}`
        : "";

    // Build conversation history lines (all messages except the last user message)
    const prior = data.messages.slice(0, -1);
    const historyLines =
      prior.length > 0
        ? `\nHistorial de la conversación:\n${prior
            .map((m) =>
              m.role === "user" ? `Usuario: ${m.content}` : `Vos: ${m.content}`,
            )
            .join("\n")}\n`
        : "";

    const lastMsg = data.messages[data.messages.length - 1].content;

    const prompt = `${SYSTEM_BASE}

Contexto temporal: ${data.contextHint}${envLine}

Plataformas disponibles: ${data.platforms.join(", ")}${historyLines}
Pedido actual del usuario:
"""
${lastMsg}
"""
${tasteLine}${seedLine}${excludeLine}

${prior.length > 0 ? "Importante: es una conversación. Si el usuario refina (\"algo más viejo\", \"sin violencia\", etc.), tomalo como ajuste del pedido anterior. No repitas títulos ya recomendados." : ""}
"platform" debe ser EXACTAMENTE una de: ${data.platforms.join(", ")}.`;

    try {
      const { text } = await generateText({ model, prompt });
      const result = parseAiJson(text, resultSchema);
      if (user) {
        await logHistory(user.supabase, user.userId, {
          source: "text",
          prompt_text: lastMsg,
          time: result.filters.time,
          company: result.filters.company,
          mood: result.filters.mood,
          type: result.filters.type,
          attention: result.filters.attention ?? null,
          novelty: result.filters.novelty ?? null,
          season: data.seasonHint ?? null,
          weather: data.weatherHint ?? null,
          platforms: data.platforms,
        });
      }
      return result;
    } catch (err) {
      throw mapErr(err);
    }
  });

/* ---------- inferMomentFilters (text → filter values) ---------- */

const inferInputSchema = z.object({
  text: z.string().min(3).max(500),
});

export const inferMomentFilters = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inferInputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
    const provider = createAiProvider(apiKey);
    const model = provider("claude-haiku-4-5-20251001");

    const prompt = `Eres un asistente que traduce la descripción de una situación recurrente de ver streaming a filtros estructurados.

Descripción del usuario:
"""
${data.text}
"""

Devolvé ÚNICAMENTE JSON válido con esta forma exacta, sin markdown ni texto extra:
{"time":"","company":"","mood":"","type":"","attention":"","novelty":""}

Reglas:
- "time" debe ser uno de: "30 min" | "1 hora" | "1.5 horas" | "Noche entera" | null si no es claro.
- "company" debe ser uno de: "Solo" | "En pareja" | "Familia con niños" | "Con amigos" | null.
- "mood" debe ser uno de: "Algo liviano" | "Comedia" | "Drama" | "Acción" | "Suspenso" | "Documental" | "Épico para relajar" | null.
- "type" debe ser uno de: "Película" | "Serie" | "Capítulo de serie" | null.
- "attention" debe ser uno de: "Inmersivo" | "De fondo" | "Comfort watch" | null.
- "novelty" debe ser uno de: "Algo nuevo" | "Algo conocido" | "Ya visto (rever)" | null.
- Si un campo no se infiere razonablemente, usa null (no inventes).`;

    try {
      const { text } = await generateText({ model, prompt });
      const result = parseAiJson(text, filtersOutSchema);
      return result;
    } catch (err) {
      throw mapErr(err);
    }
  });
