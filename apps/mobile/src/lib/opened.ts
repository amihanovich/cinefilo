// "Abiertos recientemente": lo que el usuario eligió abrir desde Miru (tocó
// "Ver en X"). Registro LOCAL por dispositivo (no hay cuenta), pensado para
// volver a un título sin buscarlo de nuevo.
//
// Qué es y qué NO es (decisión de producto, revisión con Carlos 2026-09):
//   - registra "abrimos la app de streaming en/para este título" (via: cómo);
//   - NO es progreso de reproducción: no inventa episodio, minuto ni si la
//     terminaste, y no captura lo que ves entrando directo a Netflix;
//   - por eso la sección se llama "Abiertos recientemente", no "Continuar viendo".

export type OpenedVia = "deeplink" | "app-search" | "web" | "google";

export type OpenedItem = {
  title: string;
  platform: string;
  type?: string;
  year?: string | number;
  posterUrl?: string;
  /** ISO 8601 del momento en que se tocó "Ver". */
  openedAt: string;
  /** Cómo se abrió: link exacto (JustWatch), búsqueda prellenada en la app, web o Google. */
  via: OpenedVia;
  /** JustWatch confirmó que el título estaba en esa plataforma al abrirlo. */
  confirmed: boolean;
};

export const OPENED_KEY = "miru:opened";
const MAX_OPENED = 30;

export function loadOpened(): OpenedItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as OpenedItem[]).filter((o) => o && typeof o.title === "string") : [];
  } catch {
    return [];
  }
}

function save(list: OpenedItem[]): void {
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(list.slice(0, MAX_OPENED))); } catch { /* sin storage */ }
}

const sameKey = (a: { title: string; platform: string }, b: { title: string; platform: string }) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.platform === b.platform;

/**
 * Registra una apertura. Sin duplicados: si el título ya estaba, sube al tope
 * con la fecha nueva. Devuelve la lista actualizada (más reciente primero).
 */
export function recordOpened(
  item: { title: string; platform: string; type?: string; year?: string | number; posterUrl?: string },
  meta: { via: OpenedVia; confirmed: boolean },
  now: Date = new Date(),
): OpenedItem[] {
  if (!item.title || !item.platform) return loadOpened();
  const entry: OpenedItem = {
    title: item.title,
    platform: item.platform,
    type: item.type,
    year: item.year,
    posterUrl: item.posterUrl,
    openedAt: now.toISOString(),
    via: meta.via,
    confirmed: meta.confirmed,
  };
  const rest = loadOpened().filter((o) => !sameKey(o, entry));
  const next = [entry, ...rest].slice(0, MAX_OPENED);
  save(next);
  return next;
}

export function removeOpened(title: string, platform: string): OpenedItem[] {
  const next = loadOpened().filter((o) => !sameKey(o, { title, platform }));
  save(next);
  return next;
}

/** "recién" / "hace 3 h" / "hace 2 días" / "hace 3 semanas". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 2) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? "ayer" : `hace ${d} días`;
  const w = Math.round(d / 7);
  if (w < 5) return w === 1 ? "hace 1 semana" : `hace ${w} semanas`;
  const mo = Math.round(d / 30);
  return mo <= 1 ? "hace 1 mes" : `hace ${mo} meses`;
}
