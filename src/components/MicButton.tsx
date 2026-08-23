import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function MicButton({
  onTranscript,
  lang = "es-AR",
  className,
  size = "md",
  mode = "toggle",
}: {
  onTranscript: (text: string, isFinal: boolean) => void;
  lang?: string;
  className?: string;
  /** "sm" = compact icon, "md" = prominent orb */
  size?: "sm" | "md";
  /** "toggle" = tap to start/stop, "push" = hold to talk */
  mode?: "toggle" | "push";
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(!!getRecognitionCtor());
    return () => {
      try { recRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  const start = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;   // survive short pauses
    rec.interimResults = true;

    let accumulated = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let didSubmit = false;

    const submit = () => {
      if (didSubmit) return;
      didSubmit = true;
      const final = accumulated.trim();
      if (final) onTranscript(final, true);
    };

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      // 2.2s of silence → auto-stop
      silenceTimer = setTimeout(() => {
        try { rec.stop(); } catch { /* noop */ }
      }, 2200);
    };

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) accumulated += (accumulated ? " " : "") + r[0].transcript;
        else interim += r[0].transcript;
      }
      resetSilenceTimer(); // any speech activity resets the countdown
      onTranscript((accumulated + (interim ? " " + interim : "")).trim(), false);
    };

    rec.onerror = (e: any) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setListening(false);
      if (e?.error === "not-allowed") {
        toast.error("Permití el micrófono en el navegador (ícono del candado en la barra).");
      } else if (e?.error === "network") {
        toast.error("Error de red con el reconocimiento de voz. Intentá de nuevo.");
      } else if (e?.error !== "aborted") {
        toast.error("No se pudo escuchar. Intentá de nuevo.");
      }
    };

    rec.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setListening(false);
      submit();
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      // Safety cap: if user never speaks, stop after 12s
      silenceTimer = setTimeout(() => {
        try { rec.stop(); } catch { /* noop */ }
      }, 12000);
    } catch {
      setListening(false);
      toast.error("No se pudo iniciar el micrófono. ¿Está permitido en este navegador?");
    }
  };

  const stop = () => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  };

  if (!supported) return null;

  const pushProps =
    mode === "push"
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            start();
          },
          onPointerUp: () => stop(),
          onPointerLeave: () => { if (listening) stop(); },
        }
      : { onClick: listening ? stop : start };

  if (size === "sm") {
    return (
      <button
        type="button"
        {...pushProps}
        aria-label={listening ? "Detener grabación" : "Dictar por voz"}
        title={mode === "push" ? "Mantené apretado para hablar" : listening ? "Detener" : "Hablar"}
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 select-none",
          listening
            ? "bg-destructive/10 text-destructive shadow-[0_0_0_3px_oklch(0.55_0.22_25_/_0.18)]"
            : "text-muted-foreground/50 hover:text-primary hover:bg-primary/8",
          className,
        )}
      >
        {listening ? (
          <>
            <MicOff className="h-4 w-4" />
            <span className="pointer-events-none absolute inset-0 rounded-full animate-ping bg-destructive/20" />
          </>
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
    );
  }

  // md: prominent orb
  return (
    <button
      type="button"
      {...pushProps}
      aria-label={listening ? "Detener grabación" : "Dictar por voz"}
      title={mode === "push" ? "Mantené apretado para hablar" : listening ? "Detener" : "Hablar"}
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 select-none",
        listening
          ? [
              "bg-destructive text-white",
              "shadow-[0_0_0_4px_oklch(0.55_0.22_25_/_0.18),0_0_18px_4px_oklch(0.55_0.22_25_/_0.30)]",
              "scale-110",
            ]
          : [
              "bg-gradient-primary text-primary-foreground",
              "shadow-[0_2px_12px_oklch(0.55_0.22_280_/_0.35),0_0_0_0_transparent]",
              "hover:shadow-[0_4px_20px_oklch(0.55_0.22_280_/_0.55),0_0_0_4px_oklch(0.55_0.22_280_/_0.12)]",
              "active:scale-110",
            ],
        className,
      )}
    >
      {listening ? (
        <>
          <MicOff className="h-5 w-5" />
          <span className="pointer-events-none absolute inset-0 rounded-full animate-ping bg-destructive/30" />
        </>
      ) : (
        <Mic className="h-5 w-5" />
      )}
    </button>
  );
}
