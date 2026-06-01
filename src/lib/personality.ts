/**
 * Builds a narrative viewer personality profile from implicit behavioral signals
 * (search_history + title_feedback). The resulting text is injected into the AI
 * prompt so recommendations feel like they come from someone who knows the user.
 *
 * No new tables required — works entirely from existing data.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

interface SearchRow {
  created_at: string;
  source: string;
  prompt_text: string | null;
  mood_filter: string | null;
  company_filter: string | null;
  attention_filter: string | null;
  novelty_filter: string | null;
  time_filter: string | null;
}

interface FeedbackRow {
  sentiment: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function mode<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

// Returns 0-23 hour from ISO date string.
function hour(iso: string): number {
  return new Date(iso).getHours();
}

// Returns true if the date falls on a weekend (Fri-Sun).
function isWeekend(iso: string): boolean {
  const d = new Date(iso).getDay(); // 0=Sun,1=Mon,...,6=Sat
  return d === 0 || d === 5 || d === 6;
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function buildViewerPersonality(
  supabase: SupabaseClient,
  userId: string,
  opts?: { currentQueryLength?: number; currentSource?: string },
): Promise<string | null> {
  // Fetch last 60 searches and all feedback in parallel.
  const [{ data: searches }, { data: feedbacks }] = await Promise.all([
    supabase
      .from("search_history")
      .select("created_at,source,prompt_text,mood_filter,company_filter,attention_filter,novelty_filter,time_filter")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("title_feedback")
      .select("sentiment")
      .eq("user_id", userId),
  ]);

  const sh: SearchRow[] = searches ?? [];
  const fb: FeedbackRow[] = feedbacks ?? [];

  // Need at least a minimum signal to say something meaningful.
  if (sh.length < 5 && fb.length < 5) return null;

  // ── search signals ──────────────────────────────────────────────────────────

  const n = sh.length;

  // Query length (text searches only, to measure descriptiveness)
  const textSearches = sh.filter((s) => s.source === "text" && s.prompt_text);
  const queryLengths = textSearches.map((s) => s.prompt_text!.length);
  const avgQueryLen =
    queryLengths.length > 0
      ? Math.round(queryLengths.reduce((a, b) => a + b, 0) / queryLengths.length)
      : null;

  const textRatioPct = pct(textSearches.length, n);
  const nightSearches = sh.filter((s) => { const h = hour(s.created_at); return h >= 21 || h <= 3; });
  const nightPct = pct(nightSearches.length, n);
  const weekendSearches = sh.filter((s) => isWeekend(s.created_at));
  const weekendPct = pct(weekendSearches.length, n);

  // Compute peak hour bucket
  const hourCounts = new Map<number, number>();
  for (const s of sh) {
    const h = hour(s.created_at);
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
  }
  let peakHour: number | null = null;
  let peakHourN = 0;
  for (const [h, c] of hourCounts) if (c > peakHourN) { peakHour = h; peakHourN = c; }

  const dominantMood = mode(sh.map((s) => s.mood_filter).filter(Boolean) as string[]);
  const dominantCompany = mode(sh.map((s) => s.company_filter).filter(Boolean) as string[]);
  const dominantAttention = mode(sh.map((s) => s.attention_filter).filter(Boolean) as string[]);
  const dominantNovelty = mode(sh.map((s) => s.novelty_filter).filter(Boolean) as string[]);

  // Mood variety: how often does the user switch moods? (0=always same, 1=always different)
  const moodValues = sh.map((s) => s.mood_filter).filter(Boolean) as string[];
  const uniqueMoods = new Set(moodValues).size;
  const moodVarietyPct = moodValues.length > 0 ? pct(uniqueMoods, moodValues.length) : 0;

  // ── feedback signals ────────────────────────────────────────────────────────

  const loveN = fb.filter((f) => f.sentiment === "love").length;
  const likeN = fb.filter((f) => f.sentiment === "like").length;
  const dislikeN = fb.filter((f) => f.sentiment === "dislike").length;
  const seenN = fb.filter((f) => f.sentiment === "seen").length;
  const opinionated = loveN + likeN + dislikeN;
  const loveIntensityPct =
    opinionated > 0 ? pct(loveN, opinionated) : null;

  // ── narrative construction ──────────────────────────────────────────────────

  const parts: string[] = [];

  // --- Decision style ---
  if (avgQueryLen !== null && n >= 5) {
    if (avgQueryLen < 28 && textRatioPct < 50) {
      parts.push(
        "Estilo de búsqueda: decisivo y estructurado — usa filtros más que texto libre, con consultas cortas. Sabe lo que quiere antes de buscarlo.",
      );
    } else if (avgQueryLen > 55 || textRatioPct > 75) {
      parts.push(
        `Estilo de búsqueda: explorador descriptivo — escribe lo que siente (promedio ${avgQueryLen} caracteres). Piensa en voz alta hasta encontrar qué quiere; le ayuda que el asistente lo ayude a definir.`,
      );
    } else {
      parts.push("Estilo de búsqueda: versátil — alterna entre consultas precisas y búsquedas más abiertas.");
    }
  }

  // --- Temporal pattern ---
  if (n >= 8) {
    if (nightPct >= 65) {
      const hourStr = peakHour !== null ? ` (pico ~${peakHour}h)` : "";
      parts.push(
        `Patrón temporal: espectador nocturno${hourStr} — ${nightPct}% de sus búsquedas son entre las 21h y las 3h.`,
      );
    } else if (weekendPct >= 65) {
      parts.push(
        `Patrón temporal: espectador de fin de semana — ${weekendPct}% de sus búsquedas son viernes a domingo.`,
      );
    } else if (weekendPct <= 30 && n >= 10) {
      parts.push(
        "Patrón temporal: espectador de días de semana — busca principalmente en días laborales.",
      );
    }
  }

  // --- Social context ---
  if (dominantCompany) {
    const companyMap: Record<string, string> = {
      "Solo": "casi siempre solo",
      "En pareja": "mayormente en pareja",
      "Familia con niños": "en familia con niños",
      "Con amigos": "con amigos",
    };
    const compStr = companyMap[dominantCompany] ?? dominantCompany.toLowerCase();
    parts.push(`Contexto social: ve ${compStr} en la mayoría de sus sesiones.`);
  }

  // --- Taste intensity ---
  if (opinionated >= 5 && loveIntensityPct !== null) {
    if (loveIntensityPct >= 50) {
      parts.push(
        `Intensidad de gusto: muy selectivo — de ${opinionated} títulos valorados, ${loveIntensityPct}% son "love". Cuando algo le encanta, lo declara sin dudar. Las recomendaciones tibias no le sirven.`,
      );
    } else if (dislikeN > 0 && pct(dislikeN, opinionated) >= 30) {
      parts.push(
        `Intensidad de gusto: opinionado en ambas direcciones — descarta activamente lo que no le gusta (${pct(dislikeN, opinionated)}% de dislikes). Ser específico y atrevido es mejor que ser seguro y genérico.`,
      );
    } else if (loveIntensityPct <= 15 && likeN >= 8) {
      parts.push(
        `Intensidad de gusto: contemplativo — registra mucho pero declara pocos favoritos absolutos. Prefiere explorar que comprometerse. Alternativas variadas son más valiosas que una sola recomendación perfecta.`,
      );
    }
  } else if (seenN >= 10 && opinionated < 3) {
    parts.push(
      "Historial: anota lo que vio pero rara vez da feedback de gusto/disgusto explícito. Enfocate en el pedido del momento más que en preferencias declaradas.",
    );
  }

  // --- Content preferences ---
  const contentPrefs: string[] = [];
  if (dominantAttention === "De fondo") {
    contentPrefs.push("contenido episódico y liviano que no exija atención continua");
  } else if (dominantAttention === "Inmersivo") {
    contentPrefs.push("experiencias cinematográficas para sumergirse, no de fondo");
  } else if (dominantAttention === "Comfort watch") {
    contentPrefs.push("titles reconfortantes, ya conocidos o predecibles en el buen sentido");
  }
  if (dominantMood) {
    contentPrefs.push(`mood dominante: "${dominantMood}"`);
  }
  if (dominantNovelty === "Algo nuevo") {
    contentPrefs.push("inclinado a descubrir cosas nuevas por sobre lo familiar");
  } else if (dominantNovelty === "Algo conocido") {
    contentPrefs.push("prefiere lo conocido y de calidad probada sobre los estrenos");
  }
  if (moodVarietyPct >= 60 && moodValues.length >= 8) {
    contentPrefs.push("cambia mucho de mood según el momento — es estado-de-ánimo-dependiente");
  }
  if (contentPrefs.length > 0) {
    parts.push(`Preferencias de contenido: ${contentPrefs.join("; ")}.`);
  }

  // --- Current query signal ---
  const qLen = opts?.currentQueryLength;
  if (qLen !== null && qLen !== undefined) {
    if (qLen < 20) {
      parts.push(
        "Señal del momento: query muy corta → está en modo «decidí vos». Quiere una recomendación directa y confiada, no una lista de opciones abiertas.",
      );
    } else if (qLen > 80) {
      parts.push(
        "Señal del momento: query muy detallada → sabe exactamente lo que busca. Respetá los detalles al pie de la letra.",
      );
    }
  }

  // ── final assembly ──────────────────────────────────────────────────────────

  if (parts.length === 0) return null;

  return `Perfil del espectador (señales implícitas — usalas para afinar el tono y la elección):\n${parts.map((p) => `- ${p}`).join("\n")}`;
}
