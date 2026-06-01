import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// How long to wait after the last speech activity before auto-submitting.
// 2.8s gives enough room for a slow, thoughtful speaker to pause mid-sentence.
const SILENCE_MS = 2800;

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceOrb({
  onFinalTranscript,
  onTranscriptChange,
  disabled = false,
  lang = "es-AR",
}: {
  onFinalTranscript: (text: string) => void;
  onTranscriptChange?: (text: string) => void;
  disabled?: boolean;
  lang?: string;
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const accRef = useRef(""); // accumulated final text across utterances
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSupported(!!getCtor());
    return () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      try { recRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  const resetSilenceTimer = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => {
      // Silence detected — stop the recognition; onend will fire and submit.
      try { recRef.current?.stop(); } catch { /* noop */ }
    }, SILENCE_MS);
  };

  const start = () => {
    const Ctor = getCtor();
    if (!Ctor) { setSupported(false); return; }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;       // keep listening through natural pauses
    rec.interimResults = true;   // surface partial words immediately

    accRef.current = "";

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          accRef.current += (accRef.current ? " " : "") + r[0].transcript.trim();
        } else {
          interim += r[0].transcript;
        }
      }
      const displayed = accRef.current + (interim ? " " + interim : "");
      onTranscriptChange?.(displayed);
      // Reset the silence countdown on every speech event.
      resetSilenceTimer();
    };

    rec.onerror = (e: any) => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      setListening(false);
      onTranscriptChange?.("");
      if (e?.error === "not-allowed") toast.error("Permití el micrófono en el navegador.");
      else if (e?.error !== "aborted") toast.error("No se pudo escuchar. Intentá de nuevo.");
    };

    rec.onend = () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      setListening(false);
      onTranscriptChange?.("");
      const final = accRef.current.trim();
      accRef.current = "";
      if (final) onFinalTranscript(final);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      toast.error("No se pudo iniciar el micrófono.");
    }
  };

  const stop = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    try { recRef.current?.stop(); } catch { /* noop */ }
    // onend will fire and handle transcript submission
  };

  const toggle = () => {
    if (disabled) return;
    listening ? stop() : start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={listening ? "Detener grabación" : "Hablar con el asistente"}
      className={cn(
        "group relative flex items-center justify-center outline-none",
        "h-44 w-44 sm:h-52 sm:w-52",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {/* Outer ambient bloom */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full transition-all duration-700",
          listening ? "scale-125 opacity-50" : "scale-100 opacity-20",
        )}
        style={{
          background:
            "conic-gradient(from 0deg, #3b82f6, #8b5cf6, #ec4899, #06b6d4, #3b82f6)",
          filter: "blur(28px)",
        }}
      />

      {/* Spinning ring */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute rounded-full",
          listening
            ? "[animation:spin_1.4s_linear_infinite]"
            : "[animation:spin_6s_linear_infinite]",
        )}
        style={{
          inset: "-4px",
          background:
            "conic-gradient(from 0deg, #3b82f6, #8b5cf6, #ec4899, #06b6d4, #3b82f6)",
          filter: "blur(3px)",
          opacity: listening ? 1 : 0.65,
        }}
      />

      {/* Ring mask */}
      <span
        aria-hidden="true"
        className="absolute inset-[6px] rounded-full"
        style={{ background: "oklch(0.986 0.002 275)" }}
      />

      {/* Center sphere */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-[8px] rounded-full transition-all duration-500",
          listening
            ? "[animation:orb-listen_0.8s_ease-in-out_infinite]"
            : "[animation:orb-breathe_3s_ease-in-out_infinite]",
        )}
        style={{
          background: "radial-gradient(circle at 38% 32%, #1c1250 0%, #060614 65%)",
          boxShadow: listening
            ? "inset 0 0 40px rgba(139,92,246,0.4), inset 0 0 80px rgba(59,130,246,0.2)"
            : "inset 0 0 20px rgba(79,70,229,0.15)",
        }}
      />

      {/* Icon */}
      <span className="relative z-10 text-white transition-all duration-300">
        {listening ? (
          <MicOff className="h-7 w-7 opacity-90 sm:h-8 sm:w-8" />
        ) : supported ? (
          <Mic className="h-7 w-7 opacity-50 group-hover:opacity-80 sm:h-8 sm:w-8" />
        ) : null}
      </span>
    </button>
  );
}
