// VoiceAgent: overlay de voz opt-in. Se monta sobre la pantalla de cards.
// LEY de interacción (igual en toda la app): tocás para hablar (señal clara de
// que escucha), tocás de nuevo para frenar. Ahí el wizard decide vía `route`:
// - pedido de búsqueda → la rueda de plataformas (SearchLoading) reemplaza todo
//   y este overlay se desmonta;
// - pregunta / charla de asesor → la respuesta se muestra y se habla ACÁ, y el
//   orbe queda listo para seguir conversando.

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoicePill } from "./VoicePill";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { X } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "done";

export type VoiceRoute = { mode: "search" } | { mode: "ask"; answer: string };

interface VoiceAgentProps {
  // Decide el destino de lo dicho (pregunta vs búsqueda). Si devuelve "search",
  // el wizard ya disparó la rueda y este overlay se va a desmontar solo.
  route: (text: string) => Promise<VoiceRoute>;
  onDismiss: () => void;
  // Si es false, NO saluda por TTS: abre escuchando directo (pedido d — "Pedile a
  // Cinéfilo" desde la Home). La entrada de la app sí saluda.
  greet?: boolean;
}

const GREETING = "Hola, soy Cinéfilo. Estoy acá para ayudarte a encontrar esa peli o serie que querés ver hoy. ¿Empezamos? Simplemente decime qué tenés ganas de ver.";
// Aperturas siguientes en la misma sesión: saludo corto (menos costo TTS, menos espera).
const GREETING_SHORT = "Decime qué tenés ganas de ver.";
let greetedThisSession = false;

export function VoiceAgentOverlay({ route, onDismiss, greet = true }: VoiceAgentProps) {
  const [state, setState] = useState<AgentState>(greet ? "speaking" : "idle");
  const [volume, setVolume] = useState(0);
  const [hint, setHint] = useState("...");
  const [answer, setAnswer] = useState<string | null>(null);
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
    setAnswer(null);
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
      // Si el overlay se desmonta por fuera de handleDismiss (re-render del
      // padre), cortar el saludo TTS y soltar el micrófono: antes el audio
      // seguía sonando y el MediaStream quedaba caliente.
      mountedRef.current = false;
      stopSpeaking();
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListeningManual = useCallback(async () => {
    setVolume(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    // Cinéfilo "pensando": el orbe pasa a azul mientras transcribe y decide si
    // es una pregunta (responde acá) o un pedido (rueda de plataformas).
    setState("thinking");

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
      const result = await route(text);
      if (!mountedRef.current) return;
      if (result.mode === "ask") {
        setAnswer(result.answer);
        setState("speaking");
        await speak(result.answer);
        if (mountedRef.current) setState("idle");
      }
      // mode "search": el wizard ya mostró la rueda; este overlay se desmonta solo.
    } catch {
      if (mountedRef.current) {
        setState("idle");
        setHint("No pude responder eso. Probá de nuevo.");
      }
    }
  }, [route]);

  const handleOrbClick = useCallback(() => {
    if (state === "listening") {
      void stopListeningManual();
    } else if (state === "idle" || state === "done") {
      void startListening();
    } else if (state === "speaking") {
      // Interrumpir saludo/respuesta y escuchar ya
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

  // Solo mensajes de error ("No te escuché…"): la mecánica vive en la VoicePill.
  const errHint = state === "idle" && hint !== "..." && hint !== "Te escucho..." ? hint : null;

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

      {/* Respuesta del asesor / errores */}
      {(answer || errHint) && (
        <div className="mt-6 max-h-[28vh] max-w-sm overflow-y-auto px-6 text-center">
          {answer ? (
            <p className="text-base leading-relaxed text-white/85">{answer}</p>
          ) : (
            <p className="text-sm font-medium leading-relaxed text-white/75 tracking-wide">{errHint}</p>
          )}
        </div>
      )}
    </div>
  );
}
