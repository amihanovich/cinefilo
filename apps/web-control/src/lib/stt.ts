// STT para el navegador móvil. Grabamos con MediaRecorder y detectamos el
// silencio midiendo el volumen con AudioContext; el audio se transcribe en el
// backend con Groq Whisper. Copia de apps/mobile/src/lib/stt.ts (funciona igual
// en el WebView de Capacitor que en un browser normal).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

const SPEAK_THRESHOLD = 0.045;
const DEFAULT_SILENCE_MS = 2000;
const NO_SPEECH_MS = 8000;
const MAX_RECORD_MS = 20000;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private onAutoStopCb?: () => void;
  private autoStopped = false;
  private hasSpoken = false;
  private noSpeech = false;
  private lastLoudTime = 0;

  async start(opts?: {
    onVolume?: (v: number) => void;
    onAutoStop?: () => void;
    silenceMs?: number;
  }): Promise<void> {
    this.onAutoStopCb = opts?.onAutoStop;
    this.autoStopped = false;
    this.hasSpoken = false;
    this.noSpeech = false;
    this.chunks = [];
    const silenceMs = opts?.silenceMs ?? DEFAULT_SILENCE_MS;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;

    const rec = new MediaRecorder(stream);
    this.rec = rec;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.start();

    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AC();
    this.audioCtx = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.analyser = analyser;

    const data = new Uint8Array(analyser.fftSize);
    this.lastLoudTime = performance.now();

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      opts?.onVolume?.(rms);

      const now = performance.now();
      if (rms > SPEAK_THRESHOLD) {
        this.hasSpoken = true;
        this.lastLoudTime = now;
      }

      if (this.hasSpoken && now - this.lastLoudTime > silenceMs && !this.autoStopped) {
        this.autoStopped = true;
        this.stopMonitoring();
        this.onAutoStopCb?.();
        return;
      }

      if (!this.hasSpoken && now - this.lastLoudTime > NO_SPEECH_MS && !this.autoStopped) {
        this.autoStopped = true;
        this.noSpeech = true;
        this.stopMonitoring();
        this.onAutoStopCb?.();
        return;
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);

    this.maxTimer = setTimeout(() => {
      if (!this.autoStopped) {
        this.autoStopped = true;
        this.stopMonitoring();
        this.onAutoStopCb?.();
      }
    }, MAX_RECORD_MS);
  }

  private stopMonitoring(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.maxTimer) { clearTimeout(this.maxTimer); this.maxTimer = null; }
    this.analyser = null;
    if (this.audioCtx) {
      try { void this.audioCtx.close(); } catch { /* noop */ }
      this.audioCtx = null;
    }
  }

  private releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  stop(): Promise<Blob> {
    this.stopMonitoring();
    const rec = this.rec;

    if (this.noSpeech) {
      try { if (rec && rec.state !== "inactive") rec.stop(); } catch { /* noop */ }
      this.releaseStream();
      this.chunks = [];
      return Promise.resolve(new Blob([], { type: "audio/webm" }));
    }

    if (!rec || rec.state === "inactive") {
      this.releaseStream();
      return Promise.resolve(new Blob(this.chunks, { type: "audio/webm" }));
    }

    return new Promise((resolve) => {
      const safety = setTimeout(() => {
        this.releaseStream();
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      }, 2500);

      rec.onstop = () => {
        clearTimeout(safety);
        this.releaseStream();
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      };

      try {
        rec.stop();
      } catch {
        clearTimeout(safety);
        this.releaseStream();
        resolve(new Blob(this.chunks, { type: "audio/webm" }));
      }
    });
  }

  cancel(): void {
    this.stopMonitoring();
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch { /* noop */ }
    this.rec = null;
    this.releaseStream();
    this.chunks = [];
  }
}

export async function transcribe(audioBlob: Blob): Promise<string> {
  if (audioBlob.size < 1) return "";
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: "POST",
    headers: { "Content-Type": audioBlob.type || "audio/webm" },
    body: audioBlob,
  });
  if (!res.ok) throw new Error(`Transcripción fallida: ${res.status}`);
  const data = (await res.json()) as { text: string };
  return data.text ?? "";
}
