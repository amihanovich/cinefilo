/**
 * Perfil "semilla" del usuario invitado, guardado en localStorage.
 * Sirve para inyectar contexto estable (edad + títulos amados) al motor de
 * recomendaciones desde el minuto 0, sin requerir login.
 *
 * Al loguearse, este seed se migra a la cuenta (ver __root.tsx).
 */

export type AgeBracket = "18-29" | "30-45" | "46+";

export type GuestSeed = {
  ageBracket: AgeBracket | null;
  lovedTitles: string[];
  onboardedAt: string | null;
  searchCount: number;
  loginNudgeDismissedAt: string | null;
};

const KEY = "queveo:guest:seed";

const empty: GuestSeed = {
  ageBracket: null,
  lovedTitles: [],
  onboardedAt: null,
  searchCount: 0,
  loginNudgeDismissedAt: null,
};

export function readGuestSeed(): GuestSeed {
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<GuestSeed>;
    return {
      ageBracket: (parsed.ageBracket ?? null) as AgeBracket | null,
      lovedTitles: Array.isArray(parsed.lovedTitles)
        ? parsed.lovedTitles.filter((t): t is string => typeof t === "string").slice(0, 8)
        : [],
      onboardedAt: typeof parsed.onboardedAt === "string" ? parsed.onboardedAt : null,
      searchCount: typeof parsed.searchCount === "number" ? parsed.searchCount : 0,
      loginNudgeDismissedAt:
        typeof parsed.loginNudgeDismissedAt === "string" ? parsed.loginNudgeDismissedAt : null,
    };
  } catch {
    return empty;
  }
}

export function writeGuestSeed(patch: Partial<GuestSeed>): GuestSeed {
  const current = readGuestSeed();
  const next: GuestSeed = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return next;
}

export function markOnboarded(ageBracket: AgeBracket | null, lovedTitles: string[]): GuestSeed {
  return writeGuestSeed({
    ageBracket,
    lovedTitles: lovedTitles.filter(Boolean).slice(0, 5),
    onboardedAt: new Date().toISOString(),
  });
}

export function skipOnboarding(): GuestSeed {
  return writeGuestSeed({ onboardedAt: new Date().toISOString() });
}

export function bumpSearchCount(): number {
  const current = readGuestSeed();
  const next = current.searchCount + 1;
  writeGuestSeed({ searchCount: next });
  return next;
}

export function dismissLoginNudge() {
  writeGuestSeed({ loginNudgeDismissedAt: new Date().toISOString() });
}

export function isOnboarded(): boolean {
  return readGuestSeed().onboardedAt !== null;
}

/**
 * Serializa el seed al shape que esperan las server functions
 * (campos opcionales, sin metadata local).
 */
export function seedForServer(seed: GuestSeed): {
  ageBracket?: string;
  lovedTitles?: string[];
} | undefined {
  const out: { ageBracket?: string; lovedTitles?: string[] } = {};
  if (seed.ageBracket) out.ageBracket = seed.ageBracket;
  if (seed.lovedTitles.length > 0) out.lovedTitles = seed.lovedTitles;
  return Object.keys(out).length > 0 ? out : undefined;
}
