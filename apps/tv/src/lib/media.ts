// Modelo unificado de lo que se muestra en pantalla y puente con el protocolo
// del teléfono (MediaItem). Un DeckItem es una Recommendation + un `id` estable:
// las recomendaciones de la IA usan slug del título; las listas que llegan del
// teléfono (SHOW_LIST) PRESERVAN el id que trae el teléfono (p. ej. "ml0"),
// porque el teléfono después referencia ese mismo id en PLAY/FOCUS/REMOVE.

import type { Recommendation } from "./api";
import type { MediaItem } from "./tv-protocol";

export type DeckItem = {
  id: string;
  title: string;
  platform: string;
  duration: string;
  type: string;
  year?: string;
  ageRating?: string;
  reason: string;
  /** Presente solo para listas propias del teléfono (p. ej. "Mi lista"). */
  section?: string;
};

/** Slug estable a partir del título — id de las recomendaciones de la IA. */
export function slugId(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "item";
}

export function recoToDeck(r: Recommendation): DeckItem {
  return {
    id: slugId(r.title),
    title: r.title,
    platform: r.platform,
    duration: r.duration,
    type: r.type,
    year: r.year,
    ageRating: r.ageRating,
    reason: r.reason,
  };
}

/** MediaItem del teléfono → DeckItem (preservando id y section). */
export function mediaToDeck(m: MediaItem): DeckItem {
  return {
    id: m.id,
    title: m.title,
    platform: m.platform ?? "",
    duration: "",
    type: "Película",
    year: m.year ? String(m.year) : undefined,
    reason: m.reason ?? m.synopsis ?? "",
    section: m.section,
  };
}

/**
 * DeckItem → MediaItem para enviar al teléfono. DEFENSIVO: el schema del
 * teléfono valida con Zod y descarta TODO el mensaje si algún campo no cumple
 * (posterUrl debe ser URL válida, year entero). Por eso solo incluimos esos
 * campos cuando son válidos.
 */
export function deckToMedia(d: DeckItem, poster?: string | null): MediaItem {
  const item: MediaItem = { id: d.id, title: d.title };
  if (d.platform) item.platform = d.platform;
  if (d.reason) item.reason = d.reason;
  if (d.section) item.section = d.section;

  const y = d.year ? parseInt(d.year, 10) : NaN;
  if (Number.isInteger(y) && y >= 1888 && y <= 2100) item.year = y;

  if (poster && /^https?:\/\/.+/i.test(poster)) item.posterUrl = poster;

  return item;
}
