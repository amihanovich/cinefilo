// La memoria del videoclub, del lado del teléfono. Guarda las SEÑALES de gusto
// (pedidos, aperturas, descartes con motivo, manitos, veredictos al volver,
// horarios) y el PERFIL que el backend sintetiza con ellas (/api/profile).
// Todo local, sin cuenta — como el resto de Miru. El perfil viaja con cada
// pedido a /api/recommend y es lo que hace que la carta pueda decir "como la
// última vez te fuiste con X…": el "cómo supo".

import { fetchProfile, type TasteProfile } from "./api";
import { loadOpened } from "./opened";

export const TASTE_KEY = "miru:taste";

export type Verdict = "liked" | "meh" | "unseen";
/** "card" = manito en la ficha (reacción a la propuesta); "return" = "¿qué tal estuvo?" al volver. */
export type VerdictStage = "card" | "return";

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
};

const CAPS = { requests: 30, rejected: 40, verdicts: 40, shown: 80, sessions: 60 };
const REFRESH_EVERY = 3; // señales
const REFRESH_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const EXCLUDE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const empty = (): TasteStore => ({ requests: [], rejected: [], verdicts: [], shown: [], sessions: [], profile: null, pending: 0, askedAbout: null });

export function loadTaste(): TasteStore {
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_KEY) ?? "null") as Partial<TasteStore> | null;
    if (!raw || typeof raw !== "object") return empty();
    return { ...empty(), ...raw };
  } catch {
    return empty();
  }
}

function save(t: TasteStore): void {
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
  const v = loadTaste().verdicts.find((x) => x.title === title && x.stage === "card");
  return v ? v.verdict : null;
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

/** Títulos que no hay que volver a proponer: mostrados en 30 días + abiertos. */
export function excludeTitles(): string[] {
  const t = loadTaste();
  const cutoff = Date.now() - EXCLUDE_WINDOW_MS;
  const recent = t.shown.filter((s) => new Date(s.ts).getTime() > cutoff).map((s) => s.title);
  const opened = loadOpened().map((o) => o.title);
  return [...new Set([...opened, ...recent])].slice(-60);
}

/** El bloque de texto que viaja con cada pedido (≈120-200 tokens). */
export function profileBlock(): string | null {
  const t = loadTaste();
  const lines: string[] = [];
  if (t.profile?.summary) {
    lines.push(t.profile.summary);
    if (t.profile.likes.length) lines.push(`Le va: ${t.profile.likes.join(", ")}.`);
    if (t.profile.avoid.length) lines.push(`Evitar: ${t.profile.avoid.join(", ")}.`);
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
    lines.push(`Opiniones: ${verdicts.map((v) => `${v.title}: ${v.verdict === "liked" ? (v.stage === "card" ? "le gustó la propuesta (👍)" : "la vio y le gustó") : v.verdict === "meh" ? (v.stage === "card" ? "no era para esa persona (👎)" : "la vio y no tanto") : "no la vio"}`).join("; ")}.`);
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
