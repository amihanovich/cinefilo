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
