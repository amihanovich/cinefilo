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
}: {
  onTranscript: (text: string, isFinal: boolean) => void;
  lang?: string;
  className?: string;
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
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) onTranscript(final.trim(), true);
      else if (interim) onTranscript(interim.trim(), false);
    };

    rec.onerror = (e: any) => {
      setListening(false);
      if (e?.error === "not-allowed") {
        toast.error("Permití el micrófono en el navegador (ícono del candado en la barra).");
      } else if (e?.error === "network") {
        toast.error("Error de red con el reconocimiento de voz. Intentá de nuevo.");
      } else if (e?.error !== "aborted") {
        toast.error("No se pudo escuchar. Intentá de nuevo.");
      }
    };

    rec.onend = () => setListening(false);

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e: any) {
      setListening(false);
      toast.error("No se pudo iniciar el micrófono. ¿Está permitido en este navegador?");
    }
  };

  const stop = () => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      aria-label={listening ? "Detener grabación" : "Dictar por voz"}
      title={listening ? "Detener" : "Hablar"}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full transition-smooth",
        listening
          ? "animate-pulse text-destructive"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}
