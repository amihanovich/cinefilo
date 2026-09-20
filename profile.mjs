import { fetchUpstream } from "./upstream.mjs";

// La memoria del videoclub (/api/profile). Recibe las SEÑALES crudas que el
// teléfono guarda (pedidos, aperturas, descartes con motivo, veredictos,
// horarios) y devuelve un perfil de gusto compacto que después viaja con cada
// pedido a /api/recommend. Corre fuera del camino crítico (el cliente lo pide
// en segundo plano cada pocas señales), así que su costo no se siente.
// Módulo Node autónomo, como el resto del backend.

const PROFILE_SYSTEM = `Sos la memoria de Miru, el experto de tu videoclub de confianza. Te llegan las señales de UNA persona: qué pidió, qué fue a ver, qué descartó (y por qué), qué le gustó, y cuándo suele pedir. Tu trabajo es escribir lo que ese experto sabría de ella después de atenderla varias veces — para que la próxima recomendación la sorprenda con un "cómo supo".

Devolvé JSON válido y nada más:
{"summary":"","likes":[],"avoid":[],"patterns":"","asks":"","confidence":"baja"}

- "summary": 50 a 90 palabras, en segunda persona ("te tira…", "descartás…"), español rioplatense, sin emojis ni listas. Concreto: géneros, épocas, ritmo, países, directores, duraciones, tonos. Solo lo que las señales SOSTIENEN: con pocas señales, decí poco.
- "likes": 3 a 6 tags cortos (2-4 palabras) de lo que le va. "avoid": 0 a 4 tags de lo que evita.
- "patterns": UNA frase sobre cuándo pide qué (día/hora → tipo de pedido), si se ve un patrón; si no, "".
- "asks": UNA frase sobre CÓMO pide (con referencias a títulos o directores, vago, con mood, por duración, por compañía) — sirve para saber cuánto preguntar.
- "confidence": "baja" (menos de 4 señales fuertes), "media", "alta" (muchas aperturas y veredictos coherentes).

Pesos: "después de verla: le gustó / no tanto" vale más que todo; una reacción 👍/👎 a la propuesta vale como gusto declarado (pero no la vio); "fue a ver" = le interesó (no significa que la vio entera); un descarte CON motivo es una restricción explícita; un descarte sin motivo pesa poco; los pedidos muestran el registro y el humor, no necesariamente el gusto. Si hay un perfil previo, INTEGRALO con lo nuevo (no lo repitas ni lo tires): lo reciente pesa más que lo viejo. Nunca inventes títulos ni gustos que no estén en las señales.`;

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function when(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  const ago = days <= 0 ? "hoy" : days === 1 ? "ayer" : `hace ${days} días`;
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, "0")}h, ${ago}`;
}

function formatSignals({ requests, opened, rejected, verdicts, sessions, previous }) {
  const lines = [];
  if (requests.length) {
    lines.push("Pedidos (más reciente primero):");
    for (const r of requests) lines.push(`- [${when(r.ts)}${r.source === "voice" ? ", por voz" : ""}] "${r.q}"`);
  }
  if (opened.length) {
    lines.push("\nFue a ver (tocó \"Ver en X\"):");
    for (const o of opened) lines.push(`- ${o.title} (${o.platform}) — ${when(o.ts)}${o.q ? ` — había pedido: "${o.q}"` : ""}`);
  }
  if (rejected.length) {
    lines.push("\nDescartó:");
    for (const r of rejected) lines.push(`- ${r.title}${r.reason ? ` — dijo: "${r.reason}"` : " — sin motivo"}`);
  }
  // Dos momentos distintos: la manito en la ficha es una REACCIÓN a la
  // propuesta (todavía no la vio); el "¿qué tal estuvo?" al volver es un
  // veredicto después de verla. Pesan distinto y se le dice al modelo.
  const card = verdicts.filter((v) => v.stage === "card");
  const after = verdicts.filter((v) => v.stage !== "card");
  if (card.length) {
    lines.push("\nReaccionó a la propuesta en el momento (sin verla todavía):");
    for (const v of card) lines.push(`- ${v.title}: ${v.verdict === "liked" ? "👍 le cerró" : "👎 no era para esa persona"}`);
  }
  if (after.length) {
    lines.push("\nDespués de verla (Miru se lo preguntó al volver):");
    for (const v of after) lines.push(`- ${v.title}: ${v.verdict === "liked" ? "le gustó" : v.verdict === "meh" ? "no tanto" : "no la vio"}`);
  }
  if (sessions.length) {
    const buckets = {};
    for (const ts of sessions) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) continue;
      const slot = d.getHours() < 12 ? "mañana" : d.getHours() < 19 ? "tarde" : "noche";
      const k = `${DAYS[d.getDay()]} ${slot}`;
      buckets[k] = (buckets[k] || 0) + 1;
    }
    const top = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ×${n}`);
    if (top.length) lines.push(`\nCuándo usa Miru: ${top.join(", ")}`);
  }
  if (previous && previous.summary) {
    lines.push(`\nPerfil previo (integrarlo, no repetirlo):\n${previous.summary}`);
    if (Array.isArray(previous.likes) && previous.likes.length) lines.push(`Le iba: ${previous.likes.join(", ")}`);
    if (Array.isArray(previous.avoid) && previous.avoid.length) lines.push(`Evitaba: ${previous.avoid.join(", ")}`);
  }
  return lines.join("\n");
}

const tags = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 6) : []);

/**
 * @param {object} signals - ya saneadas por el server (topes de cantidad/largo)
 * @returns {Promise<{summary:string, likes:string[], avoid:string[], patterns:string, asks:string, confidence:string}>}
 */
export async function synthesizeProfile(signals) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en el servidor.");
  const body = formatSignals(signals);
  if (!body.trim()) throw new Error("Sin señales.");
  const res = await fetchUpstream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: PROFILE_SYSTEM,
      messages: [{ role: "user", content: body }],
    }),
  }, { timeoutMs: 25000 });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Anthropic HTTP " + res.status + " " + detail.slice(0, 160));
  }
  const data = await res.json();
  const text = ((data.content && data.content[0] && data.content[0].text) || "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const parsed = JSON.parse(first >= 0 && last > first ? text.slice(first, last + 1) : text);
  const conf = ["baja", "media", "alta"].includes(parsed.confidence) ? parsed.confidence : "baja";
  return {
    summary: String(parsed.summary || "").trim().slice(0, 900),
    likes: tags(parsed.likes),
    avoid: tags(parsed.avoid).slice(0, 4),
    patterns: String(parsed.patterns || "").trim().slice(0, 200),
    asks: String(parsed.asks || "").trim().slice(0, 200),
    confidence: conf,
  };
}
