// Pantalla de entrada de la app. En CADA apertura muestra un splash de marca
// breve (cubre el warmup del backend en Railway). La PRIMERA vez, tras el splash
// aparece el agente que te recibe y capta tu primer pedido (voz o texto); ese
// pedido es la 1ª búsqueda y te lleva directo a la Home. En aperturas siguientes
// el splash lleva directo a una reco fresca ("Sorprendeme" automático).

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, Shuffle, QrCode } from "lucide-react";
import { Orb } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";

const GREETING = "Hola, soy Cinéfilo. ¿Listo para que encontremos algo para que veas hoy?";
// Ejemplos tocables para arrancar (anti-parálisis): muestran QUÉ se puede pedir.
const EXAMPLES = ["Algo de terror", "Comedia para reír", "Algo corto", "Documental"];

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

interface WelcomeScreenProps {
  firstTime: boolean;
  busy: boolean; // hay una búsqueda en curso (el padre está cargando)
  error: string | null;
  onSubmit: (text: string) => void; // pedido del usuario → 1ª búsqueda
  onSurprise: () => void; // reco automática ("lo mejor para vos")
  onConnectTv?: () => void; // ir directo a escanear el QR de la TV (sin buscar antes)
}

const SPLASH_MSG = "Rastrillando las plataformas para encontrar lo tuyo…";

export function WelcomeScreen({ firstTime, busy, error, onSubmit, onSurprise, onConnectTv }: WelcomeScreenProps) {
  // Congelamos firstTime en el mount: si el padre lo cambia (al marcar la key)
  // no queremos que el efecto del splash se vuelva a disparar.
  const firstTimeRef = useRef(firstTime);
  const onSurpriseRef = useRef(onSurprise);
  onSurpriseRef.current = onSurprise;

  const [phase, setPhase] = useState<"splash" | "agent">("splash");
  const [text, setText] = useState("");
  const [micState, setMicState] = useState<"idle" | "rec" | "processing">("idle");
  const [volume, setVolume] = useState(0);
  const micRef = useRef<VoiceRecorder | null>(null);
  const greetedRef = useRef(false);

  // (a) Al aparecer el agente, Cinéfilo te recibe por voz (TTS). Best-effort:
  // si el WebView bloquea el autoplay sin gesto, falla en silencio.
  useEffect(() => {
    if (phase !== "agent" || greetedRef.current) return;
    greetedRef.current = true;
    void speak(GREETING);
    return () => stopSpeaking();
  }, [phase]);

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

  // Micrófono press-to-speak / press-to-stop: 1er toque graba, 2º toque frena →
  // transcribe → dispara la búsqueda directo. Sin auto-stop por silencio.
  const toggleMic = async () => {
    if (micState === "rec") {
      const rec = micRef.current;
      micRef.current = null;
      setMicState("processing");
      setVolume(0);
      if (!rec) { setMicState("idle"); return; }
      const blob = await rec.stop();
      if (blob.size < 500) { setMicState("idle"); return; }
      try {
        const t = await transcribe(blob);
        setMicState("idle");
        if (t.trim()) submit(t.trim());
      } catch { setMicState("idle"); }
    } else if (micState === "idle") {
      stopSpeaking(); // corta el saludo si todavía suena
      const rec = new VoiceRecorder();
      micRef.current = rec;
      try {
        await rec.start({
          autoStop: false,
          onVolume: (v) => setVolume(v),
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
  const orbPhase = micState === "rec" ? "listening" : micState === "processing" ? "thinking" : "idle";

  const connectTv = () => {
    stopSpeaking(); // corta el saludo si todavía suena
    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
      setMicState("idle");
    }
    onConnectTv?.();
  };

  return (
    <div className="relative flex h-[100dvh] flex-col items-center justify-center gap-7 bg-background px-8 text-center safe-top safe-bottom">
      {onConnectTv && (
        <button
          onClick={connectTv}
          className="absolute right-4 top-4 mt-[env(safe-area-inset-top)] flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] text-muted-foreground transition-transform active:scale-95"
          aria-label="Conectar la TV"
        >
          <QrCode className="h-3.5 w-3.5" /> Conectar TV
        </button>
      )}
      <div className="flex flex-col items-center gap-5">
        {/* Orbe = control press-to-speak. Tocá para hablar / tocá para frenar. */}
        <button
          onClick={() => void toggleMic()}
          className="relative flex items-center justify-center active:scale-95 transition-transform select-none"
          aria-label={micState === "rec" ? "Frenar" : "Hablar"}
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          {micState === "rec" && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1 ring-1 ring-red-400/40">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-semibold tracking-wide text-red-200">Grabando</span>
            </span>
          )}
          <Orb phase={orbPhase} size="full" volume={volume} />
        </button>
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
            micState === "rec" ? "bg-red-500/80" : "bg-primary",
          )}
        >
          {micState === "processing" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {micState === "rec" ? "Tocá para frenar" : micState === "processing" ? "Un segundo…" : "Tocá para hablar"}
        </button>
        <p className="text-[11px] text-muted-foreground/50">Tocá y soltá para hablar, tocá de nuevo para frenar.</p>

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

        {/* Ejemplos tocables: muestran QUÉ se puede pedir (anti-parálisis inicial). */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => submit(ex)}
              className="rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] text-muted-foreground transition-transform active:scale-95"
            >
              {ex}
            </button>
          ))}
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
