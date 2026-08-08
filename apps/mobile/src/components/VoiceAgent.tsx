// VoiceAgent: overlay de voz opt-in. Se monta sobre la pantalla de cards.
// MVP de voz (LEY en toda la app): tocás para hablar (señal clara de que
// escucha), tocás de nuevo para frenar, y lo que dijiste SIEMPRE dispara una
// búsqueda — la rueda de plataformas (SearchLoading) reemplaza todo y este
// overlay se desmonta. Sin capa conversacional (quedó dormida en el backend).

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoicePill } from "./VoicePill";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { X } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking";

interface VoiceAgentProps {
  /** Dispara la búsqueda con el literal de lo dicho; el overlay se cierra solo. */
  onSearch: (text: string) => void;
  onDismiss: () => void;
}

export function VoiceAgentOverlay({ onSearch, onDismiss }: VoiceAgentProps) {
  const [state, setState] = useState<AgentState>("idle");
  const [volume, setVolume] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mountedRef = useRef(true);

  const orbPhase: OrbPhase =
    state === "listening" ? "listening" : state === "thinking" ? "thinking" : "idle";

  const startListening = useCallback(async () => {
    if (!mountedRef.current) return;
    setHint(null);
    setState("listening");

    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;

    try {
      // Press-to-speak / press-to-stop: NO corta por silencio. El usuario frena
      // tocando el orbe (stopListeningManual). Solo medimos volumen para el visual.
      await recorder.start({
        autoStop: false,
        onVolume: (v) => {
          if (mountedRef.current) setVolume(v);
        },
      });
    } catch {
      recorderRef.current = null;
      if (mountedRef.current) {
        setState("idle");
        setHint("No se pudo acceder al micrófono.");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Si el overlay se desmonta por fuera de handleDismiss (re-render del
      // padre), soltar el micrófono: antes el MediaStream quedaba caliente.
      mountedRef.current = false;
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  const stopListeningManual = useCallback(async () => {
    setVolume(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    setState("thinking"); // transcribiendo: el orbe pasa a azul un instante

    try {
      const blob = await recorder.stop();
      if (blob.size < 1000) {
        setState("idle");
        setHint("No te escuché. Probá de nuevo.");
        return;
      }
      const text = (await transcribe(blob)).trim();
      if (!text) {
        setState("idle");
        setHint("No te escuché. Probá de nuevo.");
        return;
      }
      if (!mountedRef.current) return;
      // Siempre búsqueda: el wizard muestra la rueda y este overlay se desmonta.
      onSearch(text);
    } catch {
      if (mountedRef.current) {
        setState("idle");
        setHint("No te escuché. Probá de nuevo.");
      }
    }
  }, [onSearch]);

  const handleOrbClick = useCallback(() => {
    if (state === "listening") void stopListeningManual();
    else if (state === "idle") void startListening();
    // "thinking": ya está procesando, ignorar taps
  }, [state, startListening, stopListeningManual]);

  const handleDismiss = () => {
    if (recorderRef.current) {
      recorderRef.current.cancel();
      recorderRef.current = null;
    }
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
      {/* Cerrar */}
      <button
        onClick={handleDismiss}
        className="absolute right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 active:scale-90 transition-transform"
        style={{ top: "calc(1.5rem + env(safe-area-inset-top))" }}
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Chip de estado de escucha — indicación inequívoca grabando vs frenado */}
      {state === "listening" && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-red-500/20 px-4 py-1.5 ring-1 ring-red-400/40"
          style={{ top: "calc(1.75rem + env(safe-area-inset-top))" }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-wide text-red-200">Grabando</span>
        </div>
      )}

      {/* Orbe */}
      <button
        onClick={handleOrbClick}
        className="flex items-center justify-center active:scale-95 transition-transform select-none"
        aria-label={state === "listening" ? "Detener" : "Hablar"}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        <Orb phase={orbPhase} size="full" volume={volume} />
      </button>

      {/* La mecánica pegada al orbe: misma píldora que el welcome y el control */}
      <div className="mt-8">
        <VoicePill state={orbPhase} onClick={handleOrbClick} />
      </div>

      <p className="mt-4 max-w-xs text-center text-sm text-white/50">
        {hint ?? "Pedime qué querés ver hoy"}
      </p>
    </div>
  );
}
