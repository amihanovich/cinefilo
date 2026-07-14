// copiado VERBATIM de src/lib/tv-protocol.ts (raíz) — mantener en sync a mano.
// Es el contrato de cable con el /control desplegado. Cualquier diferencia acá
// rompe el emparejamiento en silencio (el otro extremo descarta el mensaje).

import { z } from "zod";

/**
 * Contrato de mensajes entre el modo TV y el modo control (teléfono).
 * Es la frontera para trabajar en paralelo: ambas rutas dependen solo
 * de estos schemas. Validamos en runtime con Zod (sin `any`).
 */

export const mediaItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int().optional(),
  posterUrl: z.string().url().optional(),
  platform: z.string().optional(),
  /** De qué trata (1 frase). */
  synopsis: z.string().optional(),
  /** Por qué fue elegida para esta lista (y si se aleja del pedido, lo aclara). */
  reason: z.string().optional(),
  /** Sección a la que pertenece (p. ej. "Recomendadas para vos"), para agrupar en la UI. */
  section: z.string().optional(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

/** Mensajes que el teléfono (modo control) envía a la TV. */
export const ControlCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SEARCH"),
    query: z.string().min(1),
    // Feedback local del teléfono (anónimo) para sesgar las recomendaciones.
    exclude: z.array(z.string()).optional(), // ya vistos: no recomendar
    liked: z.array(z.string()).optional(), // le gustaron: buscar en esa línea
    disliked: z.array(z.string()).optional(), // no le gustaron: evitar similares
  }),
  // FOCUS: el teléfono scrollea su lista y avisa qué ítem quedó centrado, para
  // que la TV lo resalte en vivo (reemplaza la navegación por flechas).
  z.object({ type: z.literal("FOCUS"), mediaId: z.string() }),
  // LOAD_MORE: el teléfono llegó al final de la lista → pedí más recomendaciones.
  z.object({ type: z.literal("LOAD_MORE") }),
  // REMOVE: sacar un ítem de la lista (p. ej. "Ya la vi" desde el teléfono).
  z.object({ type: z.literal("REMOVE"), mediaId: z.string() }),
  // SET_PLATFORMS: el teléfono comparte las plataformas del usuario (las que ya
  // usa en la app móvil) para que la TV las herede sin selección manual.
  z.object({ type: z.literal("SET_PLATFORMS"), platforms: z.array(z.string()) }),
  // SHOW_LIST: el teléfono pide mostrar una lista propia (p. ej. "Mi lista") en la TV.
  z.object({ type: z.literal("SHOW_LIST"), items: z.array(mediaItemSchema) }),
  z.object({
    type: z.literal("NAVIGATE"),
    direction: z.enum(["up", "down", "left", "right"]),
  }),
  z.object({ type: z.literal("SELECT"), mediaId: z.string().optional() }),
  z.object({ type: z.literal("BACK") }),
  z.object({ type: z.literal("PLAY"), mediaId: z.string() }),
  // ADD_TODAY: agregar/quitar el ítem del carrito "Para hoy" de la TV.
  z.object({ type: z.literal("ADD_TODAY"), mediaId: z.string() }),
  // OPEN_DETAIL: abrir la ficha (banner grande) del ítem en la TV.
  z.object({ type: z.literal("OPEN_DETAIL"), mediaId: z.string() }),
  // HOME: volver al home de recomendaciones de la TV desde cualquier pantalla.
  z.object({ type: z.literal("HOME") }),
  // SHOW_TODAY: mostrar el carrito "Para hoy" de la TV como lista ("Candidatas").
  z.object({ type: z.literal("SHOW_TODAY") }),
]);
export type ControlCommandMessage = z.infer<typeof ControlCommand>;

/** Mensajes que la TV envía de vuelta al teléfono. */
export const TvState = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PAIRED") }),
  z.object({
    type: z.literal("SCREEN"),
    screen: z.enum(["home", "search", "detail", "player"]),
    focusedId: z.string().nullable(),
    items: z.array(mediaItemSchema),
    todayTitles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("NOW_PLAYING"), media: mediaItemSchema }),
]);
export type TvStateMessage = z.infer<typeof TvState>;
