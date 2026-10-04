// "Creá tu cuenta": la hoja que aparece cuando se terminan las recomendaciones
// sin cuenta (o cuando tocás "Iniciar sesión"). A la manera de Claude: la
// marca, una frase, Google arriba (lo más rápido) y, debajo, mail y contraseña
// para quien no quiere usar Google.

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { MiruMark } from "./MiruMark";
import { signUpWithEmail, signInWithEmail, resetPassword } from "../lib/auth";

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

type Mode = "signup" | "signin" | "reset";

const input = "h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

export function LoginSheet({
  open, reason, onSignIn, onBeforeEmailAuth, onClose,
}: {
  open: boolean;
  /** "limit" = se terminaron las de prueba; "manual" = lo pidió el usuario. */
  reason: "limit" | "manual";
  onSignIn: () => Promise<string | null>;
  /** Antes de entrar con mail (no sale de la página): guardar lo pendiente. */
  onBeforeEmailAuth: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(reason === "limit" ? "signup" : "signin");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // La hoja queda montada aunque esté cerrada: cada vez que se abre arranca
  // limpia y en el modo que corresponde (por el límite → "Creá tu cuenta").
  useEffect(() => {
    if (!open) return;
    setMode(reason === "limit" ? "signup" : "signin");
    setError(null);
    setNotice(null);
    setBusy(null);
  }, [open, reason]);
  if (!open) return null;

  const google = async () => {
    setBusy("google"); setError(null);
    const err = await onSignIn(); // si sale bien, el navegador se va a Google
    if (err) { setBusy(null); setError("No pude abrir el login de Google. Probá de nuevo en un rato."); console.warn("[auth]", err); }
  };

  const submit = async () => {
    setError(null); setNotice(null);
    if (!email.trim()) { setError("Poné tu mail."); return; }
    if (mode === "reset") {
      setBusy("email");
      const err = await resetPassword(email);
      setBusy(null);
      if (err) setError(err); else setNotice(`Te mandé un mail a ${email.trim()} para elegir una contraseña nueva.`);
      return;
    }
    if (mode === "signup" && !name.trim()) { setError("Decime cómo te llamo."); return; }
    if (password.length < 6) { setError("La contraseña tiene que tener al menos 6 caracteres."); return; }
    setBusy("email");
    onBeforeEmailAuth();
    if (mode === "signup") {
      const { error: err, needsConfirm } = await signUpWithEmail(name, email, password);
      setBusy(null);
      if (err) setError(err);
      else if (needsConfirm) setNotice(`Te mandé un mail a ${email.trim()} para confirmar tu cuenta. Tocá el link y volvés acá ya adentro.`);
      // Si no hace falta confirmar, la sesión entra sola y la hoja se cierra.
    } else {
      const err = await signInWithEmail(email, password);
      setBusy(null);
      if (err) setError(err);
    }
  };

  const title =
    mode === "reset" ? "Recuperá tu cuenta"
    : reason === "limit" ? "Creá tu cuenta para seguir"
    : mode === "signup" ? "Creá tu cuenta" : "Entrá a Miru";

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div className="fade-in fixed inset-x-0 bottom-0 z-[70] max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-card px-6 pb-8 pt-4 shadow-2xl safe-bottom" role="dialog" aria-label={title}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
        <div className="flex justify-end">
          <button onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-auto flex max-w-xs flex-col items-center text-center">
          <MiruMark size={36} state="idle" />
          <h2 className="mt-3 font-serif text-[26px] font-bold leading-tight text-foreground">{title}</h2>
          {mode !== "reset" && (
            <p className="mt-2 text-[14px] leading-snug text-muted-foreground">
              {reason === "limit"
                ? "Ya probaste cómo elijo. Con tu cuenta sigo recomendándote, sin límite, y me acuerdo de lo que te gusta."
                : "Con tu cuenta te saludo por tu nombre y me acuerdo de lo que te gusta, en cualquier dispositivo."}
            </p>
          )}

          {mode !== "reset" && (
            <>
              <button
                onClick={() => void google()}
                disabled={!!busy}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-border bg-background text-[15px] font-semibold text-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
              >
                {busy === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleG />}
                Continuar con Google
              </button>
              <div className="my-4 flex w-full items-center gap-3 text-[12px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> o con tu mail <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form
            className="flex w-full flex-col gap-2.5"
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            {mode === "signup" && (
              <input className={input} placeholder="Tu nombre" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            )}
            <input className={input} type="email" placeholder="Tu mail" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {mode !== "reset" && (
              <input
                className={input}
                type="password"
                placeholder={mode === "signup" ? "Elegí una contraseña (6 o más)" : "Tu contraseña"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <button
              type="submit"
              disabled={!!busy}
              className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
            >
              {busy === "email" && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signup" ? "Crear cuenta" : mode === "signin" ? "Entrar" : "Mandarme el mail"}
            </button>
          </form>

          {error && <p className="mt-3 text-[13px] text-red-700" role="alert">{error}</p>}
          {notice && <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-[13px] text-foreground" role="status">{notice}</p>}

          <div className="mt-4 flex flex-col items-center gap-1.5 text-[13px]">
            {mode === "signup" && (
              <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="text-muted-foreground">
                ¿Ya tenés cuenta? <span className="font-semibold text-primary">Entrá</span>
              </button>
            )}
            {mode === "signin" && (
              <>
                <button onClick={() => { setMode("signup"); setError(null); setNotice(null); }} className="text-muted-foreground">
                  ¿No tenés cuenta? <span className="font-semibold text-primary">Creala</span>
                </button>
                <button onClick={() => { setMode("reset"); setError(null); setNotice(null); }} className="text-muted-foreground">¿Olvidaste tu contraseña?</button>
              </>
            )}
            {mode === "reset" && (
              <button onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="font-semibold text-primary">Volver</button>
            )}
          </div>

          <p className="mt-4 text-[11px] leading-snug text-muted-foreground/80">
            Al continuar aceptás los <a href="/terminos" target="_blank" rel="noreferrer" className="underline">Términos</a> y
            la <a href="/privacidad" target="_blank" rel="noreferrer" className="underline">Política de privacidad</a>.
          </p>
        </div>
      </div>
    </>
  );
}
