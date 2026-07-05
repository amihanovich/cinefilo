// Orbe de voz para la pantalla de control remoto (ControlScreen). Igual look &
// feel que el VoiceAgent de la home, pero acá el objetivo no es mostrar cards
// localmente sino seguir iterando con Cinéfilo sobre lo que se ve en la TV:
//   1) "Buscar" → pedirle más recomendaciones (dispara una búsqueda en la TV).
//   2) "Sobre esta" → preguntar sobre la película que estás mirando y que
//      Cinéfilo te asesore como experto (vía /api/ask, sin re-recomendar).

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { fetchAsk } from "../lib/api";
import { X, Search, MessageCircle } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking" | "speaking";
type Mode = "search" | "ask";

interface ControlVoiceAgentProps {
  centeredTitle: string | null;
  centeredPlatform: string | null;
  /** Dispara una búsqueda en la TV (mismo runSearch del ControlScreen). */
  onSearch: (query: string) => void;
  onDismiss: () => void;
}

export function ControlVoiceAgent({
  centeredTitle,
  centeredPlatform,
  onSearch,
  onDismiss,
}: ControlVoiceAgentProps) {
  const canAsk = !!centeredTitle;
  const [mode, setMode] = useState<Mode>(canAsk ? "ask" : "search");
  const [state, setState] = useState<AgentState>("speaking");
  const [volume, setVolume] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mountedRef = useRef(true);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const orbPhase: OrbPhase =
    state === "listening" ? "listening"
    : state === "thinking" ? "thinking"
    : state === "speaking" ? "speaking"
    : "idle";

  // Procesa lo que dijo el usuario según el modo activo.
  const handleTranscript = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || !mountedRef.current) return;

      if (modeRef.current === "search") {
        // Pedir más recomendaciones → búsqueda en la TV y cerramos el orbe.
        onSearch(q);
        onDismiss();
        return;
      }

      // Preguntar sobre la película centrada.
      setState("thinking");
      setAnswer(null);
      try {
        const { answer: a } = await fetchAsk({
          title: centeredTitle ?? "",
          platform: centeredPlatform ?? "",
          question: q,
        });
        if (!mountedRef.current) return;
        setAnswer(a);
        setState("speaking");
        await speak(a);
        if (mountedRef.current) setState("idle");
      } catch {
        if (mountedRef.current) {
          setAnswer("No pude responder eso. Probá de nuevo.");
          setState("idle");
        }
      }
    },
    [centeredTitle, centeredPlatform, onSearch, onDismiss],
  );

  const startListening = useCallback(async () => {
    if (!mountedRef.current) return;
    stopSpeaking();
    setState("listening");
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start({
        silenceMs: 2000,
        onVolume: (v) => {
          if (mountedRef.current) setVolume(v);
        },
        onAutoStop: async () => {
          if (!mountedRef.current) return;
          const blob = await recorder.stop();
          recorderRef.current = null;
          setVolume(0);
          if (blob.size < 1) {
            if (mountedRef.current) setState("idle");
            return;
          }
          if (mountedRef.current) setState("thinking");
          try {
            const text = await transcribe(blob);
            await handleTranscript(text);
          } catch {
            if (mountedRef.current) setState("idle");
          }
        },
      });
    } catch {
      recorderRef.current = null;
      if (mountedRef.current) setState("idle");
    }
  }, [handleTranscript]);

  // Al montar: saluda según el modo y arranca a escuchar.
  useEffect(() => {
    mountedRef.current = true;
    const greet = async () => {
      setState("speaking");
      const text = canAsk
        ? `Estás viendo ${centeredTitle}. Preguntame lo que quieras sobre esta, o cambiá a buscar para pedirme algo nuevo.`
        : "Decime qué querés ver y busco algo nuevo para vos.";
      await speak(text);
      if (mountedRef.current) await startListening();
    };
    void greet();
    return () => {
      mountedRef.current = false;
      stopSpeaking();
      if (recorderRef.current) {
        recorderRef.current.cancel();
        recorderRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListeningManual = useCallback(async () => {
    setState("thinking");
    setVolume(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    try {
      const blob = await recorder.stop();
      if (blob.size < 1000) {
        setState("idle");
        return;
      }
      const text = await transcribe(blob);
      await handleTranscript(text);
    } catch {
      setState("idle");
    }
  }, [handleTranscript]);

  const handleOrbClick = useCallback(() => {
    if (state === "listening") void stopListeningManual();
    else if (state === "idle") void startListening();
    else if (state === "speaking") {
      stopSpeaking();
      void startListening();
    }
  }, [state, startListening, stopListeningManual]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setAnswer(null);
    stopSpeaking();
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    setVolume(0);
    setState("idle");
  };

  const hintText =
    state === "listening" ? "Te escucho…"
    : state === "speaking" ? "Escuchame…"
    : state === "thinking" ? "Pensando…"
    : mode === "ask" ? "Tocá el orbe para preguntar" : "Tocá el orbe para buscar";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 px-6 backdrop-blur-md">
      <button
        onClick={onDismiss}
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition-transform active:scale-90"
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Selector de modo (solo tiene sentido "Sobre esta" si hay algo centrado) */}
      {canAsk && (
        <div className="mb-8 flex gap-2 rounded-full border border-white/15 bg-white/5 p-1">
          <button
            onClick={() => switchMode("ask")}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              mode === "ask" ? "bg-white/20 text-white" : "text-white/60",
            )}
          >
            <MessageCircle className="h-4 w-4" /> Sobre esta
          </button>
          <button
            onClick={() => switchMode("search")}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              mode === "search" ? "bg-white/20 text-white" : "text-white/60",
            )}
          >
            <Search className="h-4 w-4" /> Buscar algo
          </button>
        </div>
      )}

      {mode === "ask" && centeredTitle && (
        <p className="mb-6 max-w-xs text-center text-xs uppercase tracking-wide text-white/45">
          Sobre <span className="text-white/80">{centeredTitle}</span>
        </p>
      )}

      <button
        onClick={handleOrbClick}
        className="flex select-none items-center justify-center transition-transform active:scale-95"
        aria-label={state === "listening" ? "Detener" : "Hablar"}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        <Orb phase={orbPhase} size="full" volume={volume} />
      </button>

      <div className="mt-10 max-h-[28vh] max-w-sm overflow-y-auto px-2 text-center">
        {answer ? (
          <p className="text-base leading-relaxed text-white/85">{answer}</p>
        ) : (
          <p className="text-sm font-medium tracking-wide text-white/75">{hintText}</p>
        )}
      </div>
    </div>
  );
}

function cn(...c: (string | boolean | undefined | null)[]): string {
  return c.filter(Boolean).join(" ");
}
