// VoiceAgent: overlay de voz opt-in. Se monta sobre la pantalla de cards.
// Al montarse: saluda automáticamente y arranca escuchando sin que el usuario toque nada.

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { fetchRecommendation, type Recommendation, type Message } from "../lib/api";
import { inferContext, contextToPromptHint, seasonHintShort } from "../lib/context";
import { X } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "done";

export type VoiceResult = {
  items: Recommendation[];
  cinephileNote: string | null;
  messages: Message[];
};

interface VoiceAgentProps {
  platforms: string[];
  excludeTitles: string[];
  history: Message[];
  onResult: (result: VoiceResult) => void;
  onDismiss: () => void;
}

const ALL_PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];

const GREETING = "¡Hola! Contame qué querés ver y te ayudo a encontrarlo.";

export function VoiceAgentOverlay({ platforms, excludeTitles, history, onResult, onDismiss }: VoiceAgentProps) {
  const [state, setState] = useState<AgentState>("speaking"); // starts speaking greeting
  const [volume, setVolume] = useState(0);
  const [hint, setHint] = useState("...");
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mountedRef = useRef(true);

  const orbPhase: OrbPhase =
    state === "listening" ? "listening"
    : state === "thinking" ? "thinking"
    : state === "speaking" ? "speaking"
    : "idle";

  const runRecommendation = useCallback(async (userQuery: string) => {
    if (!mountedRef.current) return;
    setState("thinking");
    setHint("Pensando...");

    const effectivePlatforms = platforms.length > 0 ? platforms : ALL_PLATFORMS;
    const ctx = inferContext();
    const newMessages: Message[] = [...history, { role: "user", content: userQuery }];

    try {
      const data = await fetchRecommendation({
        messages: newMessages,
        platforms: effectivePlatforms,
        contextHint: contextToPromptHint(ctx),
        seasonHint: seasonHintShort(ctx),
        weatherHint: null,
        excludeTitles,
      });

      if (!data?.main) throw new Error("Sin resultado");

      const allItems = [data.main, ...(data.alternatives ?? []).slice(0, 4)];
      const assistantSummary = `Recomendé: ${data.main.title} y ${(data.alternatives ?? []).slice(0, 4).map((a) => a.title).join(", ")}.`;
      const updatedMessages: Message[] = [...newMessages, { role: "assistant", content: assistantSummary }];

      // Cerrar overlay inmediatamente — las cards aparecen mientras el audio sigue en background
      onResult({ items: allItems, cinephileNote: data.cinephile_note ?? null, messages: updatedMessages });
      onDismiss();

      if (data.cinephile_note) {
        void speak(data.cinephile_note);
      }
    } catch (e) {
      console.error("[VoiceAgent]", e);
      if (mountedRef.current) {
        setState("idle");
        setHint("Algo salió mal. Tocá para intentar de nuevo.");
      }
    }
  }, [platforms, excludeTitles, history, onResult, onDismiss]);

  const startListening = useCallback(async () => {
    if (!mountedRef.current) return;
    stopSpeaking();
    setState("listening");
    setHint("Te escucho...");

    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start({
        onVolume: setVolume,
        onAutoStop: async () => {
          if (!mountedRef.current) return;
          const blob = await recorder.stop();
          recorderRef.current = null;
          setVolume(0);
          if (blob.size < 1000) {
            if (mountedRef.current) {
              setState("idle");
              setHint("No te escuché. Tocá para hablar.");
            }
            return;
          }
          if (mountedRef.current) {
            setState("thinking");
            setHint("Transcribiendo...");
          }
          try {
            const text = await transcribe(blob);
            if (!text.trim()) {
              if (mountedRef.current) {
                setState("idle");
                setHint("No te escuché bien. Intentá de nuevo.");
              }
              return;
            }
            if (mountedRef.current) setHint(`"${text}"`);
            await runRecommendation(text);
          } catch {
            if (mountedRef.current) {
              setState("idle");
              setHint("Error al transcribir. Intentá de nuevo.");
            }
          }
        },
        silenceMs: 3500, // tiempo generoso para usuarios que hablan con pausas
      });
    } catch {
      recorderRef.current = null;
      if (mountedRef.current) {
        setState("idle");
        setHint("No se pudo acceder al micrófono.");
      }
    }
  }, [runRecommendation]);

  // Al montar: saluda y arranca escuchando automáticamente
  useEffect(() => {
    mountedRef.current = true;

    const greet = async () => {
      setState("speaking");
      setHint("...");
      await speak(GREETING);
      if (mountedRef.current) {
        await startListening();
      }
    };

    void greet();

    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListeningManual = useCallback(async () => {
    // Feedback visual inmediato
    setState("thinking");
    setHint("Transcribiendo...");
    setVolume(0);

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    try {
      const blob = await recorder.stop();
      if (blob.size < 1000) {
        setState("idle");
        setHint("Tocá para hablar.");
        return;
      }
      const text = await transcribe(blob);
      if (!text.trim()) {
        setState("idle");
        setHint("No te escuché. Intentá de nuevo.");
        return;
      }
      setHint(`"${text}"`);
      await runRecommendation(text);
    } catch {
      setState("idle");
      setHint("Error al transcribir. Intentá de nuevo.");
    }
  }, [runRecommendation]);

  const handleOrbClick = useCallback(() => {
    if (state === "listening") {
      void stopListeningManual();
    } else if (state === "idle" || state === "done") {
      void startListening();
    } else if (state === "speaking") {
      // Interrumpir saludo y escuchar ya
      stopSpeaking();
      void startListening();
    }
    // Si está en "thinking" no hacemos nada — ya está procesando
  }, [state, startListening, stopListeningManual]);

  const handleDismiss = () => {
    stopSpeaking();
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    onDismiss();
  };

  const hintText =
    state === "idle" ? "Tocá el orbe para hablar"
    : state === "listening" ? "Te escucho — hablá cuando quieras"
    : state === "speaking" ? "Escuchame..."
    : hint;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
      {/* Cerrar */}
      <button
        onClick={handleDismiss}
        className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 active:scale-90 transition-transform"
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Orbe */}
      <button
        onClick={handleOrbClick}
        className="flex items-center justify-center active:scale-95 transition-transform select-none"
        aria-label={state === "listening" ? "Detener" : "Hablar"}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        <Orb phase={orbPhase} size="full" volume={volume} />
      </button>

      {/* Estado */}
      <div className="mt-10 max-w-xs px-6 text-center">
        <p className="text-sm font-medium leading-relaxed text-white/75 tracking-wide">
          {hintText}
        </p>
      </div>
    </div>
  );
}
