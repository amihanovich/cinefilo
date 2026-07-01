// Text-to-speech proxied por el backend (/api/tts → ElevenLabs).
// La API key de ElevenLabs vive SOLO en el servidor — nunca en el bundle del
// APK, de donde se podría extraer descompilando.
// Devuelve una Promise que resuelve cuando el audio termina.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

export async function speak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
): Promise<void> {
  if (!text.trim()) {
    onEnd?.();
    return;
  }

  stopSpeaking();

  try {
    const res = await fetch(`${API_BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) throw new Error(`TTS ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    onStart?.();
    await new Promise<void>((resolve) => {
      audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      audio.play().catch(() => resolve());
    });
  } catch (e) {
    // Modo silencioso: si el server no tiene ELEVENLABS_API_KEY o falla la red,
    // la app sigue funcionando sin voz.
    console.warn("[tts]", e);
  } finally {
    onEnd?.();
  }
}

export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}
