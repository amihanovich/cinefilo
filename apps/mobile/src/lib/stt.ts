// Grabación de audio + transcripción via Groq Whisper (backend).

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

export type RecordingState = "idle" | "recording" | "processing";

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private onVolumeChange?: (v: number) => void;
  private onAutoStop?: () => void;
  private rafId: number | null = null;

  async start(opts?: {
    onVolume?: (v: number) => void;
    onAutoStop?: () => void;
    silenceMs?: number;
  }): Promise<void> {
    this.onVolumeChange = opts?.onVolume;
    this.onAutoStop = opts?.onAutoStop;
    const silenceMs = opts?.silenceMs ?? 2000;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.mediaRecorder.start(100);

    // Silence detection loop
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 128;
      this.onVolumeChange?.(rms);

      if (rms < 0.04) {
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => { this.onAutoStop?.(); }, silenceMs);
        }
      } else {
        if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.analyser = null;
      this.audioCtx?.close();
      this.stream?.getTracks().forEach((t) => t.stop());

      if (!this.mediaRecorder) { resolve(new Blob()); return; }
      this.mediaRecorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mediaRecorder!.mimeType }));
      };
      this.mediaRecorder.stop();
    });
  }

  cancel(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.mediaRecorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close();
  }
}

export async function transcribe(audioBlob: Blob): Promise<string> {
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: "POST",
    headers: { "Content-Type": audioBlob.type || "audio/webm" },
    body: audioBlob,
  });
  if (!res.ok) throw new Error(`Transcripción fallida: ${res.status}`);
  const data = await res.json() as { text: string };
  return data.text ?? "";
}
