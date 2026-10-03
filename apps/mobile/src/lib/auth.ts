// Cuenta de Miru: login con Google vía Supabase Auth (mismo proyecto que el
// pairing de la TV). Cliente APARTE del de lib/supabase.ts: aquel es solo para
// Realtime y no persiste sesión; este sí (localStorage "miru:auth").
//
// Modelo de acceso (decisión 2026-10): las primeras FREE_USES recomendaciones
// son sin cuenta; después, cuenta obligatoria. El conteo es local (es un MVP:
// borrar los datos del navegador lo resetea, y está bien así por ahora).

import { createClient, type Session } from "@supabase/supabase-js";

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://gyxooovdwputhznnlqhi.supabase.co";
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "sb_publishable_Rr1Xw4no3qdm2uFSI1kVYg_4asF5n6o";

export const authClient = createClient(URL_, KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // vuelve de Google con ?code=… y lo canjea solo
    flowType: "pkce",
    storageKey: "miru:auth",
  },
});

export type MiruUser = { id: string; email: string | null; name: string | null; firstName: string | null; avatarUrl: string | null };

export function toUser(session: Session | null): MiruUser | null {
  const u = session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const name = str(meta.full_name) ?? str(meta.name);
  const firstName = str(meta.given_name) ?? (name ? name.split(/\s+/)[0] : null);
  return { id: u.id, email: u.email ?? null, name, firstName, avatarUrl: str(meta.avatar_url) ?? str(meta.picture) };
}

export async function currentUser(): Promise<MiruUser | null> {
  try {
    const { data } = await authClient.auth.getSession();
    return toUser(data.session);
  } catch {
    return null;
  }
}

export function onUserChange(cb: (u: MiruUser | null) => void): () => void {
  const { data } = authClient.auth.onAuthStateChange((_e, session) => cb(toUser(session)));
  return () => data.subscription.unsubscribe();
}

/** Lo que el usuario había pedido justo cuando le saltó el login: se busca solo al volver. */
const PENDING_KEY = "miru:pending-ask";

export async function signInWithGoogle(pendingAsk?: string | null): Promise<string | null> {
  try {
    if (pendingAsk) sessionStorage.setItem(PENDING_KEY, pendingAsk);
  } catch { /* noop */ }
  const { error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  return error ? error.message : null;
}

/** Guarda lo pedido antes de un login que no sale de la página (mail + contraseña). */
export function rememberPendingAsk(q: string | null): void {
  try { if (q) sessionStorage.setItem(PENDING_KEY, q); } catch { /* noop */ }
}

// ── Mail + contraseña ────────────────────────────────────────────────────────
// Mismo Supabase Auth. Google es lo rápido; esto es para quien no quiere usar
// Google. El nombre va en user_metadata.full_name (lo lee toUser igual que el
// de Google). Si el proyecto pide confirmar el mail, signUp vuelve sin sesión
// y la app avisa "revisá tu mail".

// Los errores de Supabase vienen en inglés: los pasamos a lo que entiende la persona.
function authErrorEs(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Mail o contraseña incorrectos.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ya hay una cuenta con ese mail. Entrá con tu contraseña.";
  if (m.includes("email not confirmed")) return "Todavía no confirmaste tu mail. Buscá el mail que te mandamos (fijate en spam).";
  if (m.includes("password") && (m.includes("at least") || m.includes("short"))) return "La contraseña tiene que tener al menos 6 caracteres.";
  if (m.includes("invalid") && m.includes("email")) return "Ese mail no parece válido.";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Esperá un minuto y probá de nuevo.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Por ahora no se pueden crear cuentas con mail.";
  return "No pude completar el ingreso. Probá de nuevo.";
}

const here = () => `${window.location.origin}${window.location.pathname}`;

export async function signUpWithEmail(name: string, email: string, password: string): Promise<{ error: string | null; needsConfirm: boolean }> {
  const { data, error } = await authClient.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: name.trim() }, emailRedirectTo: here() },
  });
  if (error) return { error: authErrorEs(error.message), needsConfirm: false };
  return { error: null, needsConfirm: !data.session };
}

export async function signInWithEmail(email: string, password: string): Promise<string | null> {
  const { error } = await authClient.auth.signInWithPassword({ email: email.trim(), password });
  return error ? authErrorEs(error.message) : null;
}

export async function resetPassword(email: string): Promise<string | null> {
  const { error } = await authClient.auth.resetPasswordForEmail(email.trim(), { redirectTo: here() });
  return error ? authErrorEs(error.message) : null;
}

export function takePendingAsk(): string | null {
  try {
    const q = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return q && q.trim() ? q : null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  try { await authClient.auth.signOut(); } catch { /* noop */ }
}

// ── Usos sin cuenta ──────────────────────────────────────────────────────────
export const FREE_USES = 3;
const USES_KEY = "miru:free-uses";

export function freeUsesSpent(): number {
  try { return Math.max(0, parseInt(localStorage.getItem(USES_KEY) ?? "0", 10) || 0); } catch { return 0; }
}

export function spendFreeUse(): number {
  const n = freeUsesSpent() + 1;
  try { localStorage.setItem(USES_KEY, String(n)); } catch { /* noop */ }
  return n;
}

export function freeUsesLeft(): number {
  return Math.max(0, FREE_USES - freeUsesSpent());
}
