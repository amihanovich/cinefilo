// Copia de apps/mobile/src/lib/platform-mentions.ts — mantener en sync a mano.
// Detección de "pedido explícito de plataforma" en texto libre ("buscame algo
// en Netflix", "qué hay en Netflix o Disney") — puerto a TS de la misma lógica
// de availability.mjs (backend), para que las RUEDAS de búsqueda (que arrancan
// a girar ANTES de que el backend responda) muestren de entrada solo la
// plataforma pedida en vez del preset completo del usuario. El override real
// de la búsqueda ya lo hace el backend leyendo el mismo texto; esto es
// puramente visual. Mantener en sync a mano con availability.mjs y con la
// copia ES5 de public/tv-lite.html.

const ANY_PLATFORM_NAME =
  "(?:netflix|(?:amazon\\s+)?prime(?:\\s+video)?|disney\\s*\\+?|(?:hbo\\s*)?max|apple\\s*tv\\s*\\+?|paramount\\s*\\+?)";
const PREP = "(?:en|de|para)";
const PLATFORM_LIST_RE = new RegExp(
  `\\b${PREP}\\s+${ANY_PLATFORM_NAME}(?:\\s*(?:,|y|o|u)\\s*(?:${PREP}\\s+)?${ANY_PLATFORM_NAME})*`,
  "i",
);

const PLATFORM_NAME_RULES: { canonical: string; re: RegExp }[] = [
  { canonical: "Netflix", re: /\bnetflix\b/i },
  { canonical: "Prime Video", re: /\b(?:amazon\s+)?prime(?:\s+video)?\b/i },
  { canonical: "Disney+", re: /\bdisney\s*\+?\b/i },
  { canonical: "Max", re: /\b(?:hbo\s*)?max\b/i },
  { canonical: "Apple TV+", re: /\bapple\s*tv\s*\+?\b/i },
  { canonical: "Paramount+", re: /\bparamount\s*\+?\b/i },
];

/**
 * Si el texto nombra una o más plataformas explícitas ("en Netflix",
 * "en Netflix o Disney"), devuelve sus nombres canónicos (sin duplicados,
 * en orden de aparición). [] si no hay mención explícita.
 */
export function detectPlatformMentions(text: string): string[] {
  const t = String(text || "");
  const m = PLATFORM_LIST_RE.exec(t);
  if (!m) return [];
  const clause = m[0];
  const found: string[] = [];
  for (const rule of PLATFORM_NAME_RULES) {
    if (rule.re.test(clause) && !found.includes(rule.canonical)) found.push(rule.canonical);
  }
  return found;
}
