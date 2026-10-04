// Preferencias del dispositivo (modo guest: todo en localStorage).
// Viven acá para que las compartan la app conversacional, el wizard completo y
// el panel de cuenta, en vez de repetir las claves en cada pantalla.

// Star+ se fusionó con Disney+ en LatAm (2024): ya no es seleccionable, pero los
// mapeos internos (color, label, deeplink) se mantienen para datos viejos.
export const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Universal+"];

export const PLATFORMS_KEY = "miru:platforms";
export const COUNTRY_KEY = "miru:country";

/** Plataformas elegidas por el usuario; si nunca eligió, arrancan TODAS. */
export function loadPlatforms(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]") as string[];
    return saved.length > 0 ? saved : [...PLATFORMS];
  } catch {
    return [...PLATFORMS];
  }
}

/** Semilla: deja escritas TODAS las plataformas si el usuario nunca eligió. */
export function seedPlatforms(): void {
  try {
    if (!localStorage.getItem(PLATFORMS_KEY)) {
      localStorage.setItem(PLATFORMS_KEY, JSON.stringify(PLATFORMS));
    }
  } catch { /* noop */ }
}

// Fallback offline: deduce el país desde la timezone del dispositivo.
function countryFromTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (tz.startsWith("America/Argentina")) return "AR";
    const map: Record<string, string> = {
      "America/Montevideo": "UY",
      "America/Santiago": "CL",
      "America/Mexico_City": "MX",
      "America/Bogota": "CO",
      "America/Lima": "PE",
      "America/Sao_Paulo": "BR",
      "Europe/Madrid": "ES",
    };
    return map[tz] ?? null;
  } catch { return null; }
}

/** Detecta el país una sola vez (ipapi, con la timezone de fallback). */
export async function detectCountry(): Promise<void> {
  if (localStorage.getItem(COUNTRY_KEY)) return;
  try {
    const res = await fetch("https://ipapi.co/country/", { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const code = (await res.text()).trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) {
        localStorage.setItem(COUNTRY_KEY, code);
        return;
      }
    }
  } catch { /* silencioso */ }
  // ipapi falló (rate limit / sin red): timezone del dispositivo como fallback
  const tzCountry = countryFromTimezone();
  if (tzCountry) localStorage.setItem(COUNTRY_KEY, tzCountry);
}

export function getCountry(): string {
  try { return localStorage.getItem(COUNTRY_KEY) ?? "AR"; } catch { return "AR"; }
}

export function savePlatforms(list: string[]): void {
  try { localStorage.setItem(PLATFORMS_KEY, JSON.stringify(list)); } catch { /* noop */ }
  // Las plataformas también viajan con la cuenta (lib/tasteSync.ts).
  try { window.dispatchEvent(new Event("miru:taste-changed")); } catch { /* noop */ }
}

/** "Todas" = las 7 activas (o ninguna guardada). */
export function isAllPlatforms(list: string[]): boolean {
  return list.length === 0 || PLATFORMS.every((p) => list.includes(p));
}

/**
 * La lógica del selector "¿Dónde busco?":
 * - estando en "Todas", tocar una plataforma deja SOLO esa (empezás a armar tu combinación);
 * - después, cada toque suma o saca;
 * - si sacás la última, o terminás marcando las 7, vuelve a "Todas".
 */
export function togglePlatformIn(list: string[], platform: string): string[] {
  if (isAllPlatforms(list)) return [platform];
  const next = list.includes(platform) ? list.filter((x) => x !== platform) : [...list, platform];
  if (next.length === 0 || isAllPlatforms(next)) return [...PLATFORMS];
  // Orden canónico, así los favicons no bailan según el orden de los toques.
  return PLATFORMS.filter((p) => next.includes(p));
}

// El nombre con el que Miru te saluda ("Buenas tardes, Agus"). Opcional: sin
// nombre, el saludo va sin nombre. Se pregunta una sola vez, sin insistir.
const NAME_KEY = "miru:name";
const NAME_ASKED_KEY = "miru:name-asked";

export function getName(): string | null {
  try { return localStorage.getItem(NAME_KEY)?.trim() || null; } catch { return null; }
}

export function setName(name: string): void {
  try {
    const n = name.trim().slice(0, 30);
    if (n) localStorage.setItem(NAME_KEY, n); else localStorage.removeItem(NAME_KEY);
    localStorage.setItem(NAME_ASKED_KEY, "1");
  } catch { /* noop */ }
}

/** ¿Ya le preguntamos (y contestó o dijo "ahora no")? */
export function nameAsked(): boolean {
  try { return localStorage.getItem(NAME_ASKED_KEY) === "1"; } catch { return true; }
}

export function dismissNameAsk(): void {
  try { localStorage.setItem(NAME_ASKED_KEY, "1"); } catch { /* noop */ }
}

/** "Buen día" / "Buenas tardes" / "Buenas noches", por la hora del teléfono. */
export function timeGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 13) return "Buen día";
  if (h >= 13 && h < 20) return "Buenas tardes";
  return "Buenas noches";
}

// ── Modos de búsqueda (las "habilidades" de Miru) ───────────────────────────
// Se eligen en el + del composer y cambian CÓMO elige Miru. El cliente solo
// manda el id; las reglas viven en el backend (MODES en recommend.mjs).
export const MODES = [
  { id: "kids", label: "Con chicos", hint: "Solo ATP, nada que asuste" },
  { id: "couple", label: "Para dos", hint: "Algo para ver en pareja" },
  { id: "short", label: "Algo corto", hint: "Menos de 100 minutos" },
  { id: "binge", label: "Maratón", hint: "Series para engancharse" },
  { id: "auteur", label: "Cine de autor", hint: "Lo menos mainstream" },
  { id: "classic", label: "Un clásico", hint: "Antes del 2000" },
] as const;
export type ModeId = (typeof MODES)[number]["id"];

const MODE_KEY = "miru:mode";

/** Los modos ("habilidades") quedan apagados por ahora (decisión 2026-10). */
export const MODES_ENABLED = false;

export function loadMode(): ModeId | null {
  if (!MODES_ENABLED) return null;
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODES.some((m) => m.id === v) ? (v as ModeId) : null;
  } catch { return null; }
}

export function saveMode(mode: ModeId | null): void {
  try { if (mode) localStorage.setItem(MODE_KEY, mode); else localStorage.removeItem(MODE_KEY); } catch { /* noop */ }
}

// "Incluir ya vistas": por defecto lo marcado "Ya la vi" no se vuelve a proponer;
// con esto prendido entra de nuevo (a veces dan ganas de volver a ver una).
const INCLUDE_SEEN_KEY = "miru:include-seen";

export function loadIncludeSeen(): boolean {
  try { return localStorage.getItem(INCLUDE_SEEN_KEY) === "1"; } catch { return false; }
}

export function saveIncludeSeen(on: boolean): void {
  try { if (on) localStorage.setItem(INCLUDE_SEEN_KEY, "1"); else localStorage.removeItem(INCLUDE_SEEN_KEY); } catch { /* noop */ }
}

export function modeLabel(mode: ModeId | null): string | null {
  return MODES.find((m) => m.id === mode)?.label ?? null;
}

// Países para verificar disponibilidad (códigos JustWatch/ISO).
export const COUNTRIES: { code: string; label: string }[] = [
  { code: "AR", label: "🇦🇷 Argentina" },
  { code: "MX", label: "🇲🇽 México" },
  { code: "ES", label: "🇪🇸 España" },
  { code: "CL", label: "🇨🇱 Chile" },
  { code: "CO", label: "🇨🇴 Colombia" },
  { code: "PE", label: "🇵🇪 Perú" },
  { code: "UY", label: "🇺🇾 Uruguay" },
  { code: "BR", label: "🇧🇷 Brasil" },
  { code: "US", label: "🇺🇸 Estados Unidos" },
];

export function setCountry(code: string): void {
  try { localStorage.setItem(COUNTRY_KEY, code); } catch { /* noop */ }
}
