// STT usando Web Speech API (SpeechRecognition), igual que la versión web original.
// API pública idéntica: VoiceRecorder class + transcribe() function.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

export type RecordingState = "idle" | "recording" | "processing";

type SpeechRecLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getSpeechCtor(): (new () => SpeechRecLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class VoiceRecorder {
  private rec: SpeechRecLike | null = null;
  private accumulated = "";
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private onAutoStopCb?: () => void;
  private done = false;

  async start(opts?: {
    onVolume?: (v: number) => void;
    onAutoStop?: () => void;
    onInterimText?: (text: string) => void;
    silenceMs?: number;
  }): Promise<void> {
    const Ctor = getSpeechCtor();
    if (!Ctor) throw new Error("SpeechRecognition no disponible en este dispositivo");

    this.onAutoStopCb = opts?.onAutoStop;
    this.accumulated = "";
    this.done = false;
    const silenceMs = opts?.silenceMs ?? 2800;

    // IMPORTANTE: no usamos getUserMedia aquí.
    // En Android, getUserMedia + SpeechRecognition compiten por el micrófono
    // y SpeechRecognition falla inmediatamente. SpeechRecognition maneja el
    // micrófono internamente — el volumen se anima con onda estática en el orbe.

    const rec = new Ctor();
    rec.lang = "es-AR";
    rec.continuous = true;
    rec.interimResults = true;
    this.rec = rec;

    const resetSilenceTimer = () => {
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        try { rec.stop(); } catch { /* noop */ }
      }, silenceMs);
    };

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          this.accumulated += (this.accumulated ? " " : "") + (r[0].transcript as string).trim();
        } else {
          interim += r[0].transcript as string;
        }
      }
      const live = this.accumulated + (interim ? " " + interim : "");
      opts?.onInterimText?.(live.trim());
      resetSilenceTimer(); // cualquier actividad de voz reinicia el contador
    };

    rec.onerror = (e: any) => {
      if (e?.error === "no-speech") return;
      this.cleanup();
      this.done = true;
      this.onAutoStopCb?.();
    };

    rec.onend = () => {
      this.cleanup();
      this.done = true;
      this.onAutoStopCb?.();
    };

    rec.start();

    // Seguridad: para después de 30s si el usuario no habla nada
    this.silenceTimer = setTimeout(() => {
      try { rec.stop(); } catch { /* noop */ }
    }, 30000);
  }

  private cleanup(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  stop(): Promise<Blob> {
    if (this.done) {
      return Promise.resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
    }

    return new Promise((resolve) => {
      if (!this.rec) {
        this.cleanup();
        resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
        return;
      }

      this.rec.onend = () => {
        this.cleanup();
        this.done = true;
        resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
      };

      try {
        this.rec.stop();
      } catch {
        this.cleanup();
        resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
      }
    });
  }

  cancel(): void {
    this.cleanup();
    try { this.rec?.stop(); } catch { /* noop */ }
  }
}

export async function transcribe(audioBlob: Blob): Promise<string> {
  if (audioBlob.type === "text/plain") {
    return audioBlob.text();
  }
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: "POST",
    headers: { "Content-Type": audioBlob.type || "audio/webm" },
    body: audioBlob,
  });
  if (!res.ok) throw new Error(`Transcripción fallida: ${res.status}`);
  const data = await res.json() as { text: string };
  return data.text ?? "";
}
