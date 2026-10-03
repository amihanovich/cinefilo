// "Creá tu cuenta": la hoja que aparece cuando se terminan las recomendaciones
// sin cuenta (o cuando tocás "Iniciar sesión" en Mi cuenta). A la manera de
// Claude: la marca, una frase, y un solo botón — Continuar con Google.

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { MiruMark } from "./MiruMark";

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

export function LoginSheet({
  open, reason, onSignIn, onClose,
}: {
  open: boolean;
  /** "limit" = se terminaron las de prueba; "manual" = lo pidió desde Mi cuenta. */
  reason: "limit" | "manual";
  onSignIn: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const go = async () => {
    setBusy(true);
    setError(null);
    const err = await onSignIn(); // si sale bien, el navegador se va a Google
    if (err) {
      setBusy(false);
      setError("No pude abrir el login de Google. Probá de nuevo en un rato.");
      console.warn("[auth]", err);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div className="fade-in fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl border-t border-border bg-card px-6 pb-8 pt-4 shadow-2xl safe-bottom" role="dialog" aria-label="Creá tu cuenta">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
        <div className="flex justify-end">
          <button onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col items-center text-center">
          <MiruMark size={40} state="idle" />
          <h2 className="mt-4 font-serif text-[26px] font-bold leading-tight text-foreground">
            {reason === "limit" ? "Creá tu cuenta para seguir" : "Entrá a Miru"}
          </h2>
          <p className="mt-2 max-w-xs text-[14px] leading-snug text-muted-foreground">
            {reason === "limit"
              ? "Ya probaste cómo elijo. Con tu cuenta sigo recomendándote, sin límite, y me acuerdo de lo que te gusta."
              : "Con tu cuenta te saludo por tu nombre y me acuerdo de lo que te gusta."}
          </p>
          <button
            onClick={() => void go()}
            disabled={busy}
            className="mt-6 flex h-12 w-full max-w-xs items-center justify-center gap-2.5 rounded-full border border-border bg-background text-[15px] font-semibold text-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleG />}
            Continuar con Google
          </button>
          {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
          <p className="mt-4 max-w-xs text-[11px] leading-snug text-muted-foreground/80">
            Solo usamos tu nombre y tu mail para tu cuenta. Tus gustos quedan en tu teléfono.
          </p>
        </div>
      </div>
    </>
  );
}
