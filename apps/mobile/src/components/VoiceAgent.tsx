// VoiceAgent: overlay de voz opt-in. Se monta sobre la pantalla de cards.
// Escucha (press-to-speak / press-to-stop) y, al soltar, transcribe y DELEGA el
// texto al wizard vía onTranscript → getReco, que muestra la misma SearchLoading
// (rueda de plataformas + intención inferida) que el camino de texto. El overlay
// NO hace la recomendación ni habla el resultado: de eso se encarga getReco.

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { X } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "done";

interface VoiceAgentProps {
  // Apenas soltás la voz: el wizard cierra el overlay y muestra YA la rueda de
  // plataformas (no dejamos el orbe girando mientras transcribe).
  onListeningStopped: () => void;
  // Transcripción lista → getReco(text, "voice") (la rueda ya está en pantalla).
  onTranscript: (text: string) => void;
  // No se pudo transcribir / no se escuchó → limpiar la rueda y avisar.
  onError: () => void;
  onDismiss: () => void;
  // Si es false, NO saluda por TTS: abre escuchando directo (pedido d — "Pedile a
  // Cinéfilo" desde la Home). La entrada de la app sí saluda.
  greet?: boolean;
}

const GREETING = "Hola, soy Cinéfilo. Estoy acá para ayudarte a encontrar esa peli o serie que querés ver hoy. ¿Empezamos? Simplemente decime qué tenés ganas de ver.";
// Aperturas siguientes en la misma sesión: saludo corto (menos costo TTS, menos espera).
const GREETING_SHORT = "Decime qué tenés ganas de ver.";
let greetedThisSession = false;

export function VoiceAgentOverlay({ onListeningStopped, onTranscript, onError, onDismiss, greet = true }: VoiceAgentProps) {
  const [state, setState] = useState<AgentState>(greet ? "speaking" : "idle");
  const [volume, setVolume] = useState(0);
  const [hint, setHint] = useState("...");
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mountedRef = useRef(true);

  const orbPhase: OrbPhase =
    state === "listening" ? "listening"
    : state === "thinking" ? "thinking"
    : state === "speaking" ? "speaking"
    : "idle";

  const startListening = useCallback(async () => {
    if (!mountedRef.current) return;
    stopSpeaking();
    setState("listening");
    setHint("Te escucho...");

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

  // Al montar: saluda por TTS y arranca escuchando; si greet=false, escucha directo.
  useEffect(() => {
    mountedRef.current = true;

    const boot = async () => {
      if (!greet) {
        // Sin auto-escucha: igual que la bienvenida, esperamos que el usuario toque
        // el orbe (press-to-speak). Recién ahí graba, y al tocar de nuevo busca.
        return;
      }
      setState("speaking");
      setHint("...");
      const text = greetedThisSession ? GREETING_SHORT : GREETING;
      greetedThisSession = true;
      await speak(text);
      if (mountedRef.current) {
        await startListening();
      }
    };

    void boot();

    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListeningManual = useCallback(async () => {
    setVolume(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    // Cedemos YA a la rueda de plataformas: cerramos el overlay al instante y la
    // transcripción sigue por detrás (no dejamos el orbe girando unos segundos).
    onListeningStopped();

    try {
      const blob = await recorder.stop();
      if (blob.size < 1000) { onError(); return; }
      const text = await transcribe(blob);
      if (!text.trim()) { onError(); return; }
      onTranscript(text.trim());
    } catch {
      onError();
    }
  }, [onListeningStopped, onTranscript, onError]);

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
    : state === "listening" ? "Te escucho… tocá para frenar"
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

      {/* Chip de estado de escucha — indicación inequívoca grabando vs frenado */}
      {state === "listening" && (
        <div className="absolute top-7 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-red-500/20 px-4 py-1.5 ring-1 ring-red-400/40">
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

      {/* Estado */}
      <div className="mt-10 max-w-xs px-6 text-center">
        <p className="text-sm font-medium leading-relaxed text-white/75 tracking-wide">
          {hintText}
        </p>
        {/* Instrucción explícita del modelo de interacción (siempre visible) */}
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Tocá y soltá para hablar, tocá de nuevo para frenar.
        </p>
      </div>
    </div>
  );
}
