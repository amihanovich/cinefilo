// Text-to-speech via ElevenLabs. Devuelve una Promise que resuelve cuando el audio termina.
// Modelo: eleven_multilingual_v2 — entiende español rioplatense con naturalidad.

// Antoni: voz multilingual cálida y clara. Cambiable por cualquier voice_id de ElevenLabs.
const VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID ?? "ErXwobaYiN019PkySvjV";
const MODEL = "eleven_multilingual_v2";

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
  const apiKey = import.meta.env.VITE_ELEVENLABS_KEY as string;
  if (!apiKey || !text.trim()) {
    onEnd?.();
    return;
  }

  stopSpeaking();

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);

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
    console.warn("[tts]", e);
  } finally {
    onEnd?.();
  }
}

export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}
