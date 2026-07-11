// Orbe de voz para la pantalla de control remoto (ControlScreen). Igual look &
// feel que el VoiceAgent de la home, pero acá el objetivo es seguir iterando con
// Cinéfilo sobre lo que se ve en la TV. Ya NO hay que elegir modo: el backend
// (/api/orb) INFIERE de lo que dice el usuario si quiere PREGUNTAR sobre el
// título centrado o BUSCAR algo nuevo, y ruteamos según su respuesta.

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { fetchOrb } from "../lib/api";
import { X } from "lucide-react";

type AgentState = "idle" | "listening" | "thinking" | "speaking";

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
  const [state, setState] = useState<AgentState>("speaking");
  const [volume, setVolume] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mountedRef = useRef(true);

  const orbPhase: OrbPhase =
    state === "listening" ? "listening"
    : state === "thinking" ? "thinking"
    : state === "speaking" ? "speaking"
    : "idle";

  // Procesa lo que dijo el usuario. El backend decide: pregunta sobre el título
  // centrado (contestamos y lo hablamos) o pedido de búsqueda (buscamos en la TV).
  const handleTranscript = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || !mountedRef.current) return;
      setState("thinking");
      setAnswer(null);
      try {
        const result = await fetchOrb({
          transcript: q,
          title: centeredTitle ?? "",
          platform: centeredPlatform ?? "",
        });
        if (!mountedRef.current) return;
        if (result.mode === "search") {
          // Quiere algo nuevo → búsqueda en la TV y cerramos el orbe.
          onSearch(result.query || q);
          onDismiss();
          return;
        }
        // Pregunta sobre el título centrado → contestamos y lo hablamos.
        setAnswer(result.answer);
        setState("speaking");
        await speak(result.answer);
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
      // Press-to-speak / press-to-stop: sin auto-stop, el usuario frena tocando.
      await recorder.start({
        autoStop: false,
        onVolume: (v) => {
          if (mountedRef.current) setVolume(v);
        },
      });
    } catch {
      recorderRef.current = null;
      if (mountedRef.current) setState("idle");
    }
  }, []);

  // Al montar: saluda y arranca a escuchar.
  useEffect(() => {
    mountedRef.current = true;
    const greet = async () => {
      setState("speaking");
      const text = centeredTitle
        ? `Estás viendo ${centeredTitle}. Preguntame lo que quieras sobre esta, o pedime que te busque algo nuevo.`
        : "Decime qué querés ver, o preguntame sobre lo que estás mirando.";
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

  const hintText =
    state === "listening" ? "Te escucho…"
    : state === "speaking" ? "Escuchame…"
    : state === "thinking" ? "Pensando…"
    : "Tocá el orbe para hablar";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 px-6 backdrop-blur-md">
      <button
        onClick={onDismiss}
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition-transform active:scale-90"
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

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
