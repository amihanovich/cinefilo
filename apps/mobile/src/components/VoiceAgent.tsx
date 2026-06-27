// VoiceAgent: overlay de voz opt-in. Se monta sobre la pantalla de cards cuando el usuario
// elige "Hablar con Cinéfilo". Escucha, piensa, habla, y devuelve las recomendaciones al padre.

import { useCallback, useRef, useState } from "react";
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

export function VoiceAgentOverlay({ platforms, excludeTitles, history, onResult, onDismiss }: VoiceAgentProps) {
  const [state, setState] = useState<AgentState>("idle");
  const [volume, setVolume] = useState(0);
  const [hint, setHint] = useState("Tocá el orbe para hablar");
  const recorderRef = useRef<VoiceRecorder | null>(null);

  const orbPhase: OrbPhase =
    state === "listening" ? "listening"
    : state === "thinking" ? "thinking"
    : state === "speaking" ? "speaking"
    : "idle";

  const runRecommendation = useCallback(async (userQuery: string) => {
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

      // Pasamos los resultados al padre para que las cards se actualicen en background
      onResult({ items: allItems, cinephileNote: data.cinephile_note ?? null, messages: updatedMessages });

      if (data.cinephile_note) {
        setState("speaking");
        setHint(data.cinephile_note);
        await speak(data.cinephile_note);
      }

      // Al terminar de hablar, cerramos el overlay automáticamente
      onDismiss();
    } catch (e) {
      console.error("[VoiceAgent]", e);
      setState("idle");
      setHint("Algo salió mal. Tocá para intentar de nuevo.");
    }
  }, [platforms, excludeTitles, history, onResult]);

  const startListening = useCallback(async () => {
    if (state !== "idle" && state !== "done") return;
    stopSpeaking();
    setState("listening");
    setHint("Te escucho...");

    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start({
        onVolume: setVolume,
        onAutoStop: async () => {
          const blob = await recorder.stop();
          recorderRef.current = null;
          setVolume(0);
          if (blob.size < 1000) {
            setState("idle");
            setHint("No te escuché. Tocá para intentar de nuevo.");
            return;
          }
          setState("thinking");
          setHint("Transcribiendo...");
          try {
            const text = await transcribe(blob);
            if (!text.trim()) {
              setState("idle");
              setHint("No te escuché bien. Intentá de nuevo.");
              return;
            }
            setHint(`"${text}"`);
            await runRecommendation(text);
          } catch {
            setState("idle");
            setHint("Error al transcribir. Intentá de nuevo.");
          }
        },
        silenceMs: 2000,
      });
    } catch {
      recorderRef.current = null;
      setState("idle");
      setHint("No se pudo acceder al micrófono.");
    }
  }, [state, runRecommendation]);

  const stopListening = useCallback(async () => {
    if (state !== "listening") return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    const blob = await recorder.stop();
    recorderRef.current = null;
    setVolume(0);
    if (blob.size < 1000) {
      setState("idle");
      setHint("Tocá para hablar.");
      return;
    }
    setState("thinking");
    setHint("Transcribiendo...");
    try {
      const text = await transcribe(blob);
      if (!text.trim()) { setState("idle"); setHint("No te escuché. Intentá de nuevo."); return; }
      setHint(`"${text}"`);
      await runRecommendation(text);
    } catch {
      setState("idle");
      setHint("Error al transcribir. Intentá de nuevo.");
    }
  }, [state, runRecommendation]);

  const handleOrbClick = useCallback(() => {
    if (state === "listening") void stopListening();
    else if (state === "idle" || state === "done") void startListening();
  }, [state, startListening, stopListening]);

  const handleDismiss = () => {
    stopSpeaking();
    if (recorderRef.current) { recorderRef.current.cancel(); recorderRef.current = null; }
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      {/* Cerrar */}
      <button
        onClick={handleDismiss}
        className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90 transition-transform"
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Orbe */}
      <button
        onClick={handleOrbClick}
        className="flex items-center justify-center active:scale-95 transition-transform"
        aria-label={state === "listening" ? "Detener" : "Hablar"}
      >
        <Orb phase={orbPhase} size="full" volume={volume} />
      </button>

      {/* Hint / texto */}
      <div className="mt-10 max-w-xs px-6 text-center">
        <p className="text-sm font-medium leading-snug text-foreground/80">
          {state === "idle" && "Tocá el orbe y contame qué querés ver"}
          {state === "listening" && "Escuchando... tocá para detener"}
          {(state === "thinking" || state === "speaking" || state === "done") && hint}
        </p>
      </div>

    </div>
  );
}
