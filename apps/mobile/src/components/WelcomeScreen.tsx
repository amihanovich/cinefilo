// Pantalla de entrada de la app. En CADA apertura muestra un splash de marca
// breve (cubre el warmup del backend en Railway). La PRIMERA vez, tras el splash
// aparece el agente que te recibe y capta tu primer pedido (voz o texto); ese
// pedido es la 1ª búsqueda y te lleva directo a la Home. En aperturas siguientes
// el splash lleva directo a una reco fresca ("Sorprendeme" automático).

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, Shuffle, QrCode } from "lucide-react";
import { Orb } from "./Orb";
import { VoicePill } from "./VoicePill";
import { TopPlatformRows } from "./TopPlatformRows";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";

const GREETING = "Hola, soy Miru. ¿Listo para que encontremos algo para que veas hoy?";
// Ejemplos tocables para arrancar (anti-parálisis): muestran QUÉ se puede pedir.
const EXAMPLES = ["Algo de terror", "Comedia para reír", "Algo corto"];

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
  const [micState, setMicState] = useState<"idle" | "requesting" | "rec" | "processing">("idle");
  const [speaking, setSpeaking] = useState(false); // Miru saludando por TTS
  const [notice, setNotice] = useState<string | null>(null); // "no te escuché"
  const [micBlocked, setMicBlocked] = useState(false); // permiso de micrófono denegado
  const [volume, setVolume] = useState(0);
  const micRef = useRef<VoiceRecorder | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const greetedRef = useRef(false);

  // (a) Al aparecer el agente, Miru te recibe por voz (TTS). Best-effort:
  // si el WebView bloquea el autoplay sin gesto, falla en silencio. El orbe
  // refleja que ÉL está hablando (misma señal que los overlays de voz).
  useEffect(() => {
    if (phase !== "agent" || greetedRef.current) return;
    greetedRef.current = true;
    void speak(GREETING, () => setSpeaking(true), () => setSpeaking(false));
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
      if (blob.size < 500) {
        setMicState("idle");
        setNotice("No te escuché. Probá de nuevo.");
        return;
      }
      try {
        const t = await transcribe(blob);
        setMicState("idle");
        if (t.trim()) submit(t.trim());
        else setNotice("No te escuché. Probá de nuevo.");
      } catch {
        setMicState("idle");
        setNotice("No te escuché. Probá de nuevo.");
      }
    } else if (micState === "idle") {
      stopSpeaking(); // corta el saludo si todavía suena
      setSpeaking(false);
      setNotice(null);
      // Feedback INMEDIATO: getUserMedia queda pendiente mientras el navegador
      // muestra el prompt de permiso, y sin este estado el tap parecía no hacer
      // nada durante todo ese rato.
      setMicState("requesting");
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
        setMicBlocked(true);
      }
    }
  };

  // ── Splash / loading ────────────────────────────────────────────────────────
  if (phase === "splash" || busy) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-6 bg-background px-8 text-center safe-top safe-bottom">
        <div className="flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold tracking-tight text-foreground">Miru</span>
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="max-w-xs text-sm text-muted-foreground">
          {busy ? "Buscando las mejores opciones…" : SPLASH_MSG}
        </p>
      </div>
    );
  }

  // ── Agente (solo 1ª vez) ────────────────────────────────────────────────────
  const orbPhase =
    micState === "rec" ? "listening"
    : micState === "processing" ? "thinking"
    : micState === "requesting" ? "thinking"
    : speaking ? "speaking"
    : "idle";
  const pillState = micState === "requesting" ? "requesting" : orbPhase;

  const connectTv = () => {
    stopSpeaking(); // corta el saludo si todavía suena
    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
      setMicState("idle");
    }
    onConnectTv?.();
  };

  // La bienvenida ya no es una pantalla fija: el bloque del mic ocupa casi todo
  // el alto y debajo asoman las tiras "Top 5 en X" (catálogo sin buscar) — el
  // borde visible de la primera tira ES la affordance de scroll.
  return (
    <div className="relative h-[100dvh] overflow-y-auto bg-background safe-top safe-bottom">
      <div className="relative flex min-h-[80dvh] flex-col items-center justify-center gap-7 px-8 pb-2 text-center">
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
        {/* La mecánica pegada al orbe: el orbe ES el agente, la píldora te dice
            qué hacer y en qué estado está (mismo componente en toda la app). */}
        <VoicePill state={pillState} onClick={() => void toggleMic()} />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Hola, soy Miru</h1>
          <p className="text-base text-muted-foreground leading-snug">
            ¿Listo para encontrar qué ver hoy?<br />
            Decime por mood, por el momento, o lo que se te ocurra.
          </p>
        </div>
      </div>

      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      {notice && <p className="text-xs font-semibold text-amber-400">{notice}</p>}
      {/* El micrófono está bloqueado por el navegador/sistema: un textito no
          alcanzaba (parecía que el botón no hacía nada). Cartel claro + salida
          por texto, que siempre funciona. */}
      {micBlocked && (
        <div className="w-full max-w-sm rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-left">
          <p className="text-sm font-bold text-amber-300">El micrófono está bloqueado</p>
          <p className="mt-1 text-xs leading-snug text-amber-100/80">
            Habilitá el permiso desde el candado de la barra de direcciones (o en Ajustes → Apps → Miru →
            Permisos) y volvé a tocar el orbe. Mientras tanto, escribinos abajo lo que buscás.
          </p>
          <button
            onClick={() => { setMicBlocked(false); inputRef.current?.focus(); }}
            className="mt-2 rounded-full bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-200 active:scale-95"
          >
            Escribir en su lugar
          </button>
        </div>
      )}

      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <div className="flex w-full items-center gap-2 rounded-2xl bg-muted px-3">
          <input
            ref={inputRef}
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

      {/* Catálogo por defecto sin búsqueda: el Top 5 de cada plataforma. */}
      <div className="flex flex-col items-center px-8">
        <TopPlatformRows />
      </div>
    </div>
  );
}
