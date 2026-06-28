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

    // Resume AudioContext if suspended (common on Android WebView)
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // Silence detection loop — timer only fires after the user has spoken at least once
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    let hasSpoken = false;
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 128;
      this.onVolumeChange?.(rms);

      if (rms >= 0.04) {
        hasSpoken = true;
        if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
      } else if (hasSpoken) {
        // Only start silence countdown after user has actually spoken
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => { this.onAutoStop?.(); }, silenceMs);
        }
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

      const stopTracks = () => this.stream?.getTracks().forEach((t) => t.stop());

      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        stopTracks();
        resolve(new Blob(this.chunks, { type: "audio/webm" }));
        return;
      }

      // Capture mimeType before stop() changes recorder state
      const mimeType = this.mediaRecorder.mimeType;

      // Safety timeout: if onstop never fires (Android bug), resolve anyway
      const timeout = setTimeout(() => {
        stopTracks();
        resolve(new Blob(this.chunks, { type: mimeType }));
      }, 2500);

      this.mediaRecorder.onstop = () => {
        clearTimeout(timeout);
        // Stop tracks AFTER onstop — stopping before can prevent onstop from firing
        stopTracks();
        resolve(new Blob(this.chunks, { type: mimeType }));
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
