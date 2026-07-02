// Utilidades chicas compartidas por App.tsx y las screens — adaptado del
// patrón de apps/mobile/src/wizard.tsx (detectCountry/getCountry/cn).

const COUNTRY_KEY = "cinefilo:country";

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
  } catch {
    return null;
  }
}

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
  } catch {
    /* silencioso */
  }
  const tzCountry = countryFromTimezone();
  if (tzCountry) localStorage.setItem(COUNTRY_KEY, tzCountry);
}

export function getCountry(): string {
  return localStorage.getItem(COUNTRY_KEY) ?? "AR";
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
