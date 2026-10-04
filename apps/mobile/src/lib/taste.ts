// La memoria del videoclub, del lado del teléfono. Guarda las SEÑALES de gusto
// (pedidos, aperturas, descartes con motivo, manitos, veredictos al volver,
// horarios) y el PERFIL que el backend sintetiza con ellas (/api/profile).
// Todo local, sin cuenta — como el resto de Miru. El perfil viaja con cada
// pedido a /api/recommend y es lo que hace que la carta pueda decir "como la
// última vez te fuiste con X…": el "cómo supo".

import { fetchProfile, type TasteProfile } from "./api";
import { loadOpened } from "./opened";

export const TASTE_KEY = "miru:taste";

/** "seen" = "Ya la vi" en la ficha: no es gusto ni disgusto, es "no me la propongas". */
export type Verdict = "liked" | "meh" | "unseen" | "seen";
/**
 * "card" = manito en la ficha (reacción a la propuesta); "return" = "¿qué tal
 * estuvo?" al volver; "seen" = la marca "Ya la vi", aparte para que conviva
 * con la manito (ya la vi + me gusta).
 */
export type VerdictStage = "card" | "return" | "seen";

type TasteStore = {
  requests: { q: string; ts: string; source: "text" | "voice" }[];
  rejected: { title: string; reason: string | null; ts: string }[];
  verdicts: { title: string; verdict: Verdict; stage: VerdictStage; ts: string }[];
  shown: { title: string; ts: string }[];
  sessions: string[];
  profile: (TasteProfile & { updatedAt: string }) | null;
  /** Señales nuevas desde la última síntesis del perfil. */
  pending: number;
  /** Última apertura sobre la que Miru ya preguntó (o el usuario ya contestó). */
  askedAbout: string | null;
  /**
   * Lo que la persona le pidió a Miru que recuerde ("nada de gore", "los
   * sábados veo con mi mujer"): a mano en Mi cuenta o diciéndolo en la charla.
   * Es la señal MÁS fuerte: manda sobre el perfil deducido.
   */
  notes: MemoryNote[];
  /** Memoria pausada (como el interruptor de Claude): no viaja a los pedidos. */
  memoryOff: boolean;
  /** Etiquetas del perfil que la persona sacó: la síntesis no las vuelve a poner. */
  removedTags: string[];
};

export type MemoryNote = { id: string; text: string; ts: string; source: "manual" | "chat" };

const CAPS = { requests: 30, rejected: 40, verdicts: 40, shown: 80, sessions: 60 };
const REFRESH_EVERY = 3; // señales
const REFRESH_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const EXCLUDE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const empty = (): TasteStore => ({ requests: [], rejected: [], verdicts: [], shown: [], sessions: [], profile: null, pending: 0, askedAbout: null, notes: [], memoryOff: false, removedTags: [] });

export function loadTaste(): TasteStore {
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_KEY) ?? "null") as Partial<TasteStore> | null;
    if (!raw || typeof raw !== "object") return empty();
    return { ...empty(), ...raw };
  } catch {
    return empty();
  }
}

export type { TasteStore };

/** Evento que escucha lib/tasteSync.ts para subir los cambios a la cuenta. */
export const TASTE_CHANGED = "miru:taste-changed";
function changed(): void {
  try { window.dispatchEvent(new Event(TASTE_CHANGED)); } catch { /* noop */ }
}

/** Reemplaza la memoria local entera (la usa la sincronización con la cuenta). */
export function replaceTaste(t: TasteStore, notify = false): void {
  save(t, notify);
}

/** Borra la memoria local (al cerrar sesión: el teléfono queda limpio). */
export function clearTaste(): void {
  try { localStorage.removeItem(TASTE_KEY); } catch { /* noop */ }
}

function save(t: TasteStore, notify = true): void {
  if (notify) changed();
  try {
    localStorage.setItem(TASTE_KEY, JSON.stringify({
      ...t,
      requests: t.requests.slice(-CAPS.requests),
      rejected: t.rejected.slice(-CAPS.rejected),
      verdicts: t.verdicts.slice(-CAPS.verdicts),
      shown: t.shown.slice(-CAPS.shown),
      sessions: t.sessions.slice(-CAPS.sessions),
    }));
  } catch { /* sin storage: la memoria dura lo que dura la sesión */ }
}

const now = () => new Date().toISOString();

export function recordSession(): void {
  const t = loadTaste();
  t.sessions.push(now());
  save(t);
}

export function recordRequest(q: string, source: "text" | "voice"): void {
  const t = loadTaste();
  t.requests.push({ q: q.slice(0, 300), ts: now(), source });
  t.pending += 1;
  save(t);
}

/** Un descarte: "Dame otra" (sin motivo) o el próximo pedido tras una propuesta que no abrió (el pedido ES el motivo). */
export function recordRejection(title: string, reason: string | null): void {
  const t = loadTaste();
  t.rejected.push({ title, reason: reason ? reason.slice(0, 200) : null, ts: now() });
  t.pending += reason ? 1 : 0.5;
  save(t);
}

export function recordVerdict(title: string, verdict: Verdict, stage: VerdictStage): void {
  const t = loadTaste();
  // Una sola opinión por título y etapa: la última manda.
  t.verdicts = t.verdicts.filter((v) => !(v.title === title && v.stage === stage));
  t.verdicts.push({ title, verdict, stage, ts: now() });
  if (stage === "return") t.askedAbout = title;
  t.pending += 2; // es la señal más fuerte: acelera la síntesis
  save(t);
}

export function recordShown(title: string): void {
  const t = loadTaste();
  t.shown = t.shown.filter((s) => s.title !== title);
  t.shown.push({ title, ts: now() });
  save(t);
}

/** La manito ya puesta en una ficha (para pintarla al re-renderizar). */
export function cardVerdict(title: string): Verdict | null {
  const v = loadTaste().verdicts.find((x) => x.title === title && x.stage === "card" && x.verdict !== "seen");
  return v ? v.verdict : null;
}

/** ¿La marcó "Ya la vi"? (también lo guardado como manito antes de que fueran aparte) */
export function isSeen(title: string): boolean {
  return loadTaste().verdicts.some((x) => x.title === title && x.verdict === "seen");
}

/** Prende/apaga "Ya la vi" sin tocar la manito. */
export function setSeen(title: string, on: boolean): void {
  const t = loadTaste();
  t.verdicts = t.verdicts.filter((v) => !(v.title === title && v.verdict === "seen"));
  if (on) {
    t.verdicts.push({ title, verdict: "seen", stage: "seen", ts: now() });
    t.pending += 1;
  }
  save(t);
}

/**
 * Lo último que abrió en una sesión ANTERIOR y sobre lo que Miru todavía no
 * preguntó: al volver, "¿Qué tal estuvo X?". Una sola vez por título.
 */
export function pendingVerdict(): { title: string; platform: string } | null {
  const t = loadTaste();
  const last = loadOpened()[0];
  if (!last) return null;
  if (t.askedAbout === last.title) return null;
  if (t.verdicts.some((v) => v.title === last.title && v.stage === "return")) return null;
  // Tiene que ser de otra sesión: si la abrió hace un rato, no la vio todavía.
  const openedAt = new Date(last.openedAt).getTime();
  if (!Number.isFinite(openedAt) || Date.now() - openedAt < 3 * 60 * 60 * 1000) return null;
  return { title: last.title, platform: last.platform };
}

/** Marca que Miru ya preguntó por ese título (contestado o no): no insistir. */
export function markAsked(title: string): void {
  const t = loadTaste();
  t.askedAbout = title;
  save(t);
}

/**
 * Títulos que no hay que volver a proponer: mostrados en 30 días + abiertos +
 * "Ya la vi". Con `includeSeen` (el toggle "Incluir ya vistas") lo marcado
 * como visto vuelve a ser elegible.
 */
export function excludeTitles(includeSeen = false): string[] {
  const t = loadTaste();
  const cutoff = Date.now() - EXCLUDE_WINDOW_MS;
  const recent = t.shown.filter((s) => new Date(s.ts).getTime() > cutoff).map((s) => s.title);
  const opened = loadOpened().map((o) => o.title);
  // "Ya la vi" no vence a los 30 días: una peli vista no se vuelve a proponer.
  const seenIt = t.verdicts.filter((v) => v.verdict === "seen").map((v) => v.title);
  if (includeSeen) {
    const seenSet = new Set(seenIt);
    return [...new Set([...opened, ...recent])].filter((x) => !seenSet.has(x)).slice(-60);
  }
  return [...new Set([...seenIt, ...opened, ...recent])].slice(-60);
}

/** El bloque de texto que viaja con cada pedido (≈120-200 tokens). */
export function profileBlock(includeSeen = false): string | null {
  const t = loadTaste();
  if (t.memoryOff) return null;
  const lines: string[] = [];
  // "Incluir ya vistas": además de no excluirlas, se le avisa al motor que vale proponerlas.
  const seenIt = t.verdicts.filter((v) => v.verdict === "seen").map((v) => v.title);
  if (includeSeen && seenIt.length) {
    lines.push(`Acepta volver a ver algo que ya vio: puede proponer una de estas si encaja con el pedido (decíselo, "para volver a ver"): ${seenIt.slice(-15).join("; ")}.`);
  }
  if (t.notes.length) {
    lines.push(`Lo que te pidió que recuerdes (respetalo SIEMPRE, manda sobre todo lo demás):\n${t.notes.slice(-12).map((n) => `- ${n.text}`).join("\n")}`);
  }
  if (t.profile?.summary) {
    lines.push(t.profile.summary);
    const likes = t.profile.likes.filter((x) => !t.removedTags.includes(x));
    const avoid = t.profile.avoid.filter((x) => !t.removedTags.includes(x));
    if (likes.length) lines.push(`Le va: ${likes.join(", ")}.`);
    if (avoid.length) lines.push(`Evitar: ${avoid.join(", ")}.`);
    if (t.profile.patterns) lines.push(`Patrón: ${t.profile.patterns}`);
    if (t.profile.asks) lines.push(`Cómo pide: ${t.profile.asks}`);
    lines.push(`(confianza del perfil: ${t.profile.confidence})`);
  }
  // Señales crudas recientes, aunque no haya perfil todavía: es lo que permite
  // "cómo supo" desde la segunda sesión.
  const opened = loadOpened().slice(0, 3);
  // "Abrió" y no "vio": tocar "Ver en X" no dice si la vio. Con ese rótulo,
  // el modelo daba por vista (y hasta "recién terminada") una peli solo abierta.
  if (opened.length) lines.push(`Abrió desde Miru (tocó "Ver en X"; NO sabemos si la vio): ${opened.map((o) => `${o.title} (${o.platform}, ${timeAgo(o.openedAt)})`).join("; ")}.`);
  const verdicts = t.verdicts.slice(-4);
  if (verdicts.length) {
    lines.push(`Opiniones: ${verdicts.map((v) => `${v.title}: ${v.verdict === "liked" ? (v.stage === "card" ? "le gustó la propuesta (👍)" : "la vio y le gustó") : v.verdict === "meh" ? (v.stage === "card" ? "no era para esa persona (👎)" : "la vio y no tanto") : v.verdict === "seen" ? "ya la había visto" : "no la vio"}`).join("; ")}.`);
  }
  const rejected = t.rejected.filter((r) => r.reason).slice(-3);
  if (rejected.length) lines.push(`Descartes con motivo: ${rejected.map((r) => `${r.title} ("${r.reason}")`).join("; ")}.`);
  return lines.length ? lines.join("\n").slice(0, 1500) : null;
}

function timeAgo(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days)) return "";
  return days <= 0 ? "hoy" : days === 1 ? "ayer" : `hace ${days} días`;
}

// ── La memoria, editable (la hoja "Mi cuenta" y "acordate que…" en la charla) ──
const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Agrega algo para recordar. Devuelve false si ya estaba (mismo texto). */
export function addNote(text: string, source: "manual" | "chat"): boolean {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!clean) return false;
  const t = loadTaste();
  if (t.notes.some((n) => n.text.toLowerCase() === clean.toLowerCase())) return false;
  t.notes.push({ id: newId(), text: clean, ts: now(), source });
  t.notes = t.notes.slice(-30);
  t.pending += 2; // dicho por la persona: pesa como un veredicto
  save(t);
  return true;
}

export function removeNote(id: string): void {
  const t = loadTaste();
  t.notes = t.notes.filter((n) => n.id !== id);
  save(t);
}

/** Saca una etiqueta del perfil ("te gusta"/"evitás") y que no vuelva. */
export function removeTag(tag: string): void {
  const t = loadTaste();
  if (!t.removedTags.includes(tag)) t.removedTags.push(tag);
  if (t.profile) {
    t.profile = { ...t.profile, likes: t.profile.likes.filter((x) => x !== tag), avoid: t.profile.avoid.filter((x) => x !== tag) };
  }
  save(t);
}

export function setMemoryOff(off: boolean): void {
  const t = loadTaste();
  t.memoryOff = off;
  save(t);
}

/**
 * Borra lo que Miru sabe de vos: perfil, notas, pedidos, descartes y opiniones.
 * No toca lo ya mostrado (para no repetirte títulos) ni tus aperturas.
 */
export function clearMemory(): void {
  const t = loadTaste();
  save({ ...empty(), shown: t.shown, sessions: t.sessions, memoryOff: t.memoryOff, askedAbout: t.askedAbout });
}

/** Lo que la hoja de cuenta muestra como historial. */
export function tasteHistory(): {
  liked: string[];
  rejected: { title: string; reason: string | null }[];
} {
  const t = loadTaste();
  const liked: string[] = [];
  for (const v of [...t.verdicts].reverse()) {
    if (v.verdict === "liked" && !liked.includes(v.title)) liked.push(v.title);
  }
  const seen = new Set<string>();
  const rejected: { title: string; reason: string | null }[] = [];
  for (const r of [...t.rejected].reverse()) {
    if (seen.has(r.title)) continue;
    seen.add(r.title);
    rejected.push({ title: r.title, reason: r.reason });
  }
  return { liked: liked.slice(0, 20), rejected: rejected.slice(0, 20) };
}

/** ¿Hay perfil? (para el saludo con memoria) */
export function hasProfile(): boolean {
  return !!loadTaste().profile?.summary;
}

/**
 * Re-sintetiza el perfil en segundo plano cuando hay señales nuevas
 * suficientes o el perfil quedó viejo. Silencioso: si falla, el perfil
 * anterior sigue valiendo.
 */
let refreshing = false;
export async function maybeRefreshProfile(): Promise<void> {
  if (refreshing) return;
  const t = loadTaste();
  const stale = !t.profile || Date.now() - new Date(t.profile.updatedAt).getTime() > REFRESH_STALE_MS;
  const hasSignals = t.requests.length + t.rejected.length + t.verdicts.length + loadOpened().length >= 2;
  if (!hasSignals) return;
  if (t.pending < REFRESH_EVERY && !(stale && t.pending > 0)) return;
  refreshing = true;
  try {
    const opened = loadOpened().slice(0, 20).map((o) => ({
      title: o.title,
      platform: o.platform,
      ts: o.openedAt,
      // El pedido que llevó a esa apertura: el último anterior a la apertura.
      q: [...t.requests].reverse().find((r) => r.ts <= o.openedAt)?.q ?? "",
    }));
    const profile = await fetchProfile({
      requests: [...t.requests].reverse().slice(0, 25),
      opened,
      rejected: t.rejected.slice(-30),
      verdicts: t.verdicts.slice(-30),
      sessions: t.sessions.slice(-60),
      previous: t.profile ? { summary: t.profile.summary, likes: t.profile.likes, avoid: t.profile.avoid } : null,
      notes: t.notes.map((n) => n.text),
      removedTags: t.removedTags,
    });
    if (profile) {
      const fresh = loadTaste(); // pudo cambiar mientras tanto
      fresh.profile = { ...profile, updatedAt: now() };
      fresh.pending = 0;
      save(fresh);
    }
  } finally {
    refreshing = false;
  }
}
