// STT para Android (Capacitor WebView).
//
// IMPORTANTE: La Web Speech API (SpeechRecognition) NO funciona dentro del
// WebView de Android — necesita el servicio de reconocimiento de Google que el
// WebView no expone, por eso fallaba al instante y el orbe caía a "idle".
//
// Acá grabamos con MediaRecorder y detectamos el silencio midiendo el volumen
// con AudioContext (un solo stream compartido, sin conflicto de micrófono).
// El audio se transcribe en el backend con Groq Whisper.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

export type RecordingState = "idle" | "recording" | "processing";

// Umbral de volumen (RMS normalizado 0-1) por encima del cual consideramos que
// hay voz. Por debajo, silencio.
const SPEAK_THRESHOLD = 0.045;
// Cuánto silencio esperar tras la última voz antes de cortar y buscar.
const DEFAULT_SILENCE_MS = 2000;
// Si el usuario no habló nada en este tiempo, cortamos sin transcribir
// (evita mandar segundos de silencio a Groq: costo + espera inútil).
const NO_SPEECH_MS = 8000;
// Tope duro de grabación por seguridad.
const MAX_RECORD_MS = 20000;
// Tope de seguridad más largo para press-to-stop (el usuario controla el corte).
const MAX_PRESS_MS = 60000;

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
  private noSpeech = false; // cortó sin que el usuario hablara → no transcribir
  private lastLoudTime = 0;
  private autoStopEnabled = true; // press-to-stop: si es false solo para con stop() manual

  async start(opts?: {
    onVolume?: (v: number) => void;
    onAutoStop?: () => void;
    onInterimText?: (text: string) => void; // no aplica con MediaRecorder, se ignora
    silenceMs?: number;
    // Press-to-speak / press-to-stop: con autoStop:false NO corta por silencio ni
    // por no-speech ni por el tope duro — solo para cuando el caller llama stop().
    autoStop?: boolean;
  }): Promise<void> {
    this.onAutoStopCb = opts?.onAutoStop;
    this.autoStopEnabled = opts?.autoStop !== false;
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

    // Análisis de volumen para detectar silencio.
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
      // RMS normalizado: 128 es el centro (silencio).
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

      // Solo cortamos por silencio una vez que el usuario habló de verdad.
      // Con press-to-stop (autoStopEnabled=false) NO cortamos por silencio: el
      // usuario decide cuándo frenar, y seguimos midiendo volumen para el visual.
      if (this.autoStopEnabled && this.hasSpoken && now - this.lastLoudTime > silenceMs && !this.autoStopped) {
        this.autoStopped = true;
        this.stopMonitoring();
        this.onAutoStopCb?.();
        return;
      }

      // Si nunca habló, cortamos temprano y marcamos noSpeech (no se transcribe).
      if (this.autoStopEnabled && !this.hasSpoken && now - this.lastLoudTime > NO_SPEECH_MS && !this.autoStopped) {
        this.autoStopped = true;
        this.noSpeech = true;
        this.stopMonitoring();
        this.onAutoStopCb?.();
        return;
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);

    // Tope de seguridad: corta a los MAX_RECORD_MS hablado o no.
    // En press-to-stop lo estiramos a MAX_PRESS_MS para no cortar al usuario.
    this.maxTimer = setTimeout(() => {
      if (!this.autoStopped) {
        this.autoStopped = true;
        this.stopMonitoring();
        this.onAutoStopCb?.();
      }
    }, this.autoStopEnabled ? MAX_RECORD_MS : MAX_PRESS_MS);
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

    // Corte por no-speech: descartamos el audio (es silencio) y devolvemos
    // un blob vacío — los callers muestran "No te escuché" sin llamar a Groq.
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
      // Seguridad: si onstop no dispara (bug de Android), resolvemos igual.
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
