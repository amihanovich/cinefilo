// Pantalla de entrada de la app. En CADA apertura muestra un splash de marca
// breve (cubre el warmup del backend en Railway). La PRIMERA vez, tras el splash
// aparece el agente que te recibe y capta tu primer pedido (voz o texto); ese
// pedido es la 1ª búsqueda y te lleva directo a la Home. En aperturas siguientes
// el splash lleva directo a una reco fresca ("Sorprendeme" automático).

import { useEffect, useRef, useState } from "react";
import { Sparkles, Mic, Send, Loader2, Shuffle } from "lucide-react";
import { Orb } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

interface WelcomeScreenProps {
  firstTime: boolean;
  busy: boolean; // hay una búsqueda en curso (el padre está cargando)
  error: string | null;
  onSubmit: (text: string) => void; // pedido del usuario → 1ª búsqueda
  onSurprise: () => void; // reco automática ("lo mejor para vos")
}

const SPLASH_MSG = "Rastrillando las plataformas para encontrar lo tuyo…";

export function WelcomeScreen({ firstTime, busy, error, onSubmit, onSurprise }: WelcomeScreenProps) {
  // Congelamos firstTime en el mount: si el padre lo cambia (al marcar la key)
  // no queremos que el efecto del splash se vuelva a disparar.
  const firstTimeRef = useRef(firstTime);
  const onSurpriseRef = useRef(onSurprise);
  onSurpriseRef.current = onSurprise;

  const [phase, setPhase] = useState<"splash" | "agent">("splash");
  const [text, setText] = useState("");
  const [micState, setMicState] = useState<"idle" | "rec" | "processing">("idle");
  const micRef = useRef<VoiceRecorder | null>(null);

  // Splash → agente (1ª vez) o directo a reco fresca (aperturas siguientes).
  useEffect(() => {
    const dur = firstTimeRef.current ? 1500 : 800;
    const t = setTimeout(() => {
      if (firstTimeRef.current) setPhase("agent");
      else onSurpriseRef.current();
    }, dur);
    return () => clearTimeout(t);
  }, []);

  const submit = (t: string) => {
    const q = t.trim();
    if (q) onSubmit(q);
  };

  // Micrófono: graba → transcribe → dispara la búsqueda directo.
  const toggleMic = async () => {
    if (micState === "rec") {
      const rec = micRef.current;
      micRef.current = null;
      setMicState("processing");
      if (!rec) { setMicState("idle"); return; }
      const blob = await rec.stop();
      if (blob.size < 500) { setMicState("idle"); return; }
      try {
        const t = await transcribe(blob);
        setMicState("idle");
        if (t.trim()) submit(t.trim());
      } catch { setMicState("idle"); }
    } else if (micState === "idle") {
      const rec = new VoiceRecorder();
      micRef.current = rec;
      try {
        await rec.start({
          silenceMs: 2500,
          onAutoStop: async () => {
            micRef.current = null;
            setMicState("processing");
            const blob = await rec.stop();
            if (blob.size >= 500) {
              try {
                const t = await transcribe(blob);
                setMicState("idle");
                if (t.trim()) submit(t.trim());
                return;
              } catch { /* noop */ }
            }
            setMicState("idle");
          },
        });
        setMicState("rec");
      } catch {
        micRef.current = null;
        setMicState("idle");
      }
    }
  };

  // ── Splash / loading ────────────────────────────────────────────────────────
  if (phase === "splash" || busy) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-6 bg-background px-8 text-center safe-top safe-bottom">
        <div className="flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold tracking-tight text-foreground">Cinéfilo</span>
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="max-w-xs text-sm text-muted-foreground">
          {busy ? "Buscando las mejores opciones…" : SPLASH_MSG}
        </p>
      </div>
    );
  }

  // ── Agente (solo 1ª vez) ────────────────────────────────────────────────────
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-7 bg-background px-8 text-center safe-top safe-bottom">
      <div className="flex flex-col items-center gap-5">
        <Orb phase="idle" size="full" />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Hola, soy Cinéfilo</h1>
          <p className="text-base text-muted-foreground leading-snug">
            ¿Listo para encontrar qué ver hoy?<br />
            Decime por mood, por el momento, o lo que se te ocurra.
          </p>
        </div>
      </div>

      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}

      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <button
          onClick={() => void toggleMic()}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-white transition-transform active:scale-95",
            micState === "rec" ? "bg-primary/80" : "bg-primary",
          )}
        >
          {micState === "processing" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
          {micState === "rec" ? "Escuchando…" : micState === "processing" ? "Un segundo…" : "Tocá para hablar"}
        </button>

        <div className="flex w-full items-center gap-2 rounded-2xl bg-muted px-3">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(text); }}
            placeholder="…o escribilo acá"
            className="min-h-[48px] min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          <button
            onClick={() => submit(text)}
            disabled={!text.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
            aria-label="Buscar"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={onSurprise}
          className="mt-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-transform active:scale-95"
        >
          <Shuffle className="h-4 w-4" /> Sorprendeme
        </button>
      </div>
    </div>
  );
}
