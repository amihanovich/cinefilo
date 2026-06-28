// STT usando Web Speech API (SpeechRecognition), igual que la versión web original.
// Elimina la dependencia de MediaRecorder + Groq para la captura — mucho más estable en Android.
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

  // Visualización de volumen — capa separada, no bloquea STT si falla
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;

  async start(opts?: {
    onVolume?: (v: number) => void;
    onAutoStop?: () => void;
    silenceMs?: number;
  }): Promise<void> {
    const Ctor = getSpeechCtor();
    if (!Ctor) throw new Error("SpeechRecognition no disponible en este dispositivo");

    this.onAutoStopCb = opts?.onAutoStop;
    this.accumulated = "";
    this.done = false;
    const silenceMs = opts?.silenceMs ?? 3500;

    // Visualización de volumen via getUserMedia + AnalyserNode (opcional)
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioCtx = new AudioContext();
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 128;
        opts?.onVolume?.(rms);
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    } catch {
      // Visualización es opcional — continúa sin ella
    }

    const rec = new Ctor();
    rec.lang = "es-AR";
    rec.continuous = true;       // sobrevive pausas cortas
    rec.interimResults = false;  // solo resultados finales
    this.rec = rec;

    const resetSilenceTimer = () => {
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      // Pausa de silencio → para automáticamente
      this.silenceTimer = setTimeout(() => {
        try { rec.stop(); } catch { /* noop */ }
      }, silenceMs);
    };

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          this.accumulated += (this.accumulated ? " " : "") + (e.results[i][0].transcript as string);
        }
      }
      resetSilenceTimer(); // cualquier actividad de voz reinicia el conteo
    };

    rec.onerror = (e: any) => {
      if (e?.error === "no-speech") return; // no es error — esperando que el usuario hable
      this.cleanupVolume();
      this.done = true;
      this.onAutoStopCb?.();
    };

    rec.onend = () => {
      this.cleanupVolume();
      this.done = true;
      this.onAutoStopCb?.();
    };

    rec.start();

    // Seguridad: si el usuario no dice nada en 30s, para
    this.silenceTimer = setTimeout(() => {
      try { rec.stop(); } catch { /* noop */ }
    }, 30000);
  }

  private cleanupVolume(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.analyser = null;
    this.audioCtx?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rafId = null;
    this.silenceTimer = null;
  }

  stop(): Promise<Blob> {
    if (this.done) {
      // SpeechRecognition ya terminó — devuelve el texto acumulado inmediatamente
      return Promise.resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
    }

    return new Promise((resolve) => {
      if (!this.rec) {
        this.cleanupVolume();
        resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
        return;
      }

      // Reemplaza onend para capturar el texto al parar manualmente
      this.rec.onend = () => {
        this.cleanupVolume();
        this.done = true;
        resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
      };

      try {
        this.rec.stop();
      } catch {
        this.cleanupVolume();
        resolve(new Blob([this.accumulated.trim()], { type: "text/plain" }));
      }
    });
  }

  cancel(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    try { this.rec?.stop(); } catch { /* noop */ }
    this.cleanupVolume();
  }
}

// transcribe() ahora soporta dos tipos de Blob:
// - text/plain  → viene de SpeechRecognition, se decodifica directo
// - audio/webm  → viene de MediaRecorder (fallback), se envía al backend Groq
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
