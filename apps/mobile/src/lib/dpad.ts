// D-pad del control de la TV: qué dirección viaja a la TV según CÓMO se pidió.
//
// - Botones (flechas): mueven la SELECCIÓN — ◀ manda "left" y el foco de la TV
//   va a la izquierda. Natural, igual que el control físico de la TV.
// - Swipe sobre el pad: modelo "arrastrás el contenido" (como el scroll del
//   celular): deslizar a la derecha corre la lista a la derecha, así que el foco
//   queda a la IZQUIERDA → se manda la dirección opuesta.
//
// Decisión de producto (revisión con Carlos, 2026-09): las dos convenciones
// conviven a propósito; la TV no distingue el origen (recibe NAVIGATE + dirección).
export type Dir = "up" | "down" | "left" | "right";

const INVERT: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

/** Dirección que viaja a la TV cuando se toca un BOTÓN de flecha. */
export function buttonDirection(pressed: Dir): Dir {
  return pressed;
}

/** Dirección que viaja a la TV cuando se hace un SWIPE en el pad. */
export function swipeDirection(swiped: Dir): Dir {
  return INVERT[swiped];
}

/**
 * Clasifica un gesto por su desplazamiento (px). Devuelve null si fue un tap
 * (lo maneja el botón de abajo) — umbral 30 px, gana el eje dominante.
 */
export function swipeFromDelta(dx: number, dy: number, threshold = 30): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}
