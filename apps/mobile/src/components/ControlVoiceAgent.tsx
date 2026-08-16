// Orbe de voz para la pantalla de control remoto (ControlScreen). MVP de voz:
// hablarle a Miru SIEMPRE es pedirle una búsqueda — tocás para hablar,
// tocás para frenar, y lo que dijiste dispara la búsqueda en la TV (la rueda
// se ve allá). Sin capa conversacional: ni saludo, ni preguntas, ni respuestas
// habladas (esa capa quedó dormida en el backend por si se retoma).

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoicePill } from "./VoicePill";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { X } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking";

interface ControlVoiceAgentProps {
  centeredTitle: string | null;
  /** Dispara una búsqueda en la TV (mismo runSearch del ControlScreen). */
  onSearch: (query: string) => void;
  onDismiss: () => void;
}

export function ControlVoiceAgent({ centeredTitle, onSearch, onDismiss }: ControlVoiceAgentProps) {
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
      // Press-to-speak / press-to-stop: sin auto-stop, el usuario frena tocando.
      await recorder.start({
        autoStop: false,
        onVolume: (v) => {
          if (mountedRef.current) setVolume(v);
        },
      });
    } catch {
      recorderRef.current = null;
      if (mountedRef.current) {
        setHint("No pude acceder al micrófono. Dale permiso a Miru y probá de nuevo.");
        setState("idle");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current) {
        recorderRef.current.cancel();
        recorderRef.current = null;
      }
    };
  }, []);

  const stopListeningManual = useCallback(async () => {
    setState("thinking");
    setVolume(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    try {
      const blob = await recorder.stop();
      if (blob.size < 1000) {
        if (mountedRef.current) {
          setHint("No te escuché. Probá de nuevo.");
          setState("idle");
        }
        return;
      }
      const q = (await transcribe(blob)).trim();
      if (!mountedRef.current) return;
      if (!q) {
        setHint("No te escuché. Probá de nuevo.");
        setState("idle");
        return;
      }
      // Siempre búsqueda, con el LITERAL de lo que dijo (la TV lo muestra en la rueda).
      onSearch(q);
      onDismiss();
    } catch {
      if (mountedRef.current) {
        setHint("No te escuché. Probá de nuevo.");
        setState("idle");
      }
    }
  }, [onSearch, onDismiss]);

  const handleOrbClick = useCallback(() => {
    if (state === "thinking") return; // procesando: ignorar taps (evita reentrar)
    if (state === "listening") void stopListeningManual(); // 2º tap: frena y busca
    else void startListening(); // 1er tap: empieza a escuchar
  }, [state, startListening, stopListeningManual]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 px-6 backdrop-blur-md">
      <button
        onClick={onDismiss}
        className="absolute right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition-transform active:scale-90"
        style={{ top: "calc(1.5rem + env(safe-area-inset-top))" }}
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Chip de estado de escucha — misma señal inequívoca que el VoiceAgent */}
      {state === "listening" && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-red-500/20 px-4 py-1.5 ring-1 ring-red-400/40"
          style={{ top: "calc(1.75rem + env(safe-area-inset-top))" }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-wide text-red-200">Grabando</span>
        </div>
      )}

      {centeredTitle && (
        <p className="mb-6 max-w-xs text-center text-xs uppercase tracking-wide text-white/45">
          Mirando <span className="text-white/80">{centeredTitle}</span>
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

      {/* La mecánica pegada al orbe: misma píldora que el welcome y la home */}
      <div className="mt-8">
        <VoicePill state={orbPhase} onClick={handleOrbClick} />
      </div>

      <p className="mt-4 max-w-xs text-center text-sm text-white/50">
        {hint ?? "Pedime qué querés ver y lo busco en la TV"}
      </p>
    </div>
  );
}
