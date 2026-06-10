import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { transcribeAudio } from "@/lib/transcribe.functions";

type State = "idle" | "recording" | "transcribing";

/** Convierte un Blob de audio a base64 (en chunks, para no reventar el stack). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Botón de voz: graba un clip y lo transcribe en el servidor (Groq/Whisper).
 * Requiere "contexto seguro" (https o localhost) para acceder al micrófono —
 * sobre http por IP de LAN, navigator.mediaDevices no existe y avisamos.
 */
export function VoiceRecordButton({
  onResult,
  disabled,
}: {
  onResult: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const [secure, setSecure] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setSecure(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function" &&
        typeof window !== "undefined" &&
        "MediaRecorder" in window,
    );
    return () => {
      try {
        recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* noop */
      }
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const audioBase64 = await blobToBase64(blob);
          const { text } = await transcribeAudio({
            data: { audioBase64, mimeType: blob.type },
          });
          if (text) onResult(text);
          else toast.error("No te entendí. Probá de nuevo.");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "No pudimos transcribir.");
        } finally {
          setState("idle");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setState("recording");
    } catch (err) {
      setState("idle");
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast.error("Permití el micrófono en el navegador.");
      } else {
        toast.error("No se pudo acceder al micrófono.");
      }
    }
  };

  const stop = () => recorderRef.current?.stop();

  if (!secure) {
    return (
      <button
        type="button"
        onClick={() =>
          toast.error("El micrófono necesita una conexión segura (https). Te paso cómo activarla.")
        }
        aria-label="Micrófono no disponible"
        className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground/50"
      >
        <Mic className="h-5 w-5" />
      </button>
    );
  }

  const recording = state === "recording";
  const transcribing = state === "transcribing";

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      disabled={disabled || transcribing}
      aria-label={recording ? "Detener y transcribir" : "Pedir por voz"}
      className={`relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl transition-all active:scale-95 disabled:opacity-50 ${
        recording ? "bg-destructive text-white" : "border border-border bg-card text-foreground"
      }`}
    >
      {transcribing ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : recording ? (
        <>
          <Square className="h-4 w-4 fill-current" />
          <span className="pointer-events-none absolute inset-0 rounded-2xl bg-destructive/30 animate-ping" />
        </>
      ) : (
        <Mic className="h-5 w-5" />
      )}
    </button>
  );
}
