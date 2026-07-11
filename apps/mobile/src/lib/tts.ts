// Text-to-speech proxied por el backend (/api/tts → ElevenLabs).
// La API key de ElevenLabs vive SOLO en el servidor — nunca en el bundle del
// APK, de donde se podría extraer descompilando.
// Devuelve una Promise que resuelve cuando el audio termina.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

let currentAudio: HTMLAudioElement | null = null;

// Mute global de la voz de Cinéfilo (saludo + explicación de resultados).
// Persistido para que la elección del usuario sobreviva entre sesiones.
const MUTE_KEY = "cinefilo:tts_muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* localStorage no disponible: mute solo en memoria de esta sesión */
  }
  if (muted) stopSpeaking();
}

function nativeSynth(): SpeechSynthesis | null {
  try {
    return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  // Cortar también la voz nativa (fallback).
  try { nativeSynth()?.cancel(); } catch { /* noop */ }
}

// Fallback: voz nativa del dispositivo (Android/iOS TTS vía Web Speech). Gratis y
// sin cuota — se usa cuando /api/tts falla (p.ej. ElevenLabs sin créditos). La
// calidad es más robótica que ElevenLabs, pero Cinéfilo igual te narra.
function speakNative(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = nativeSynth();
    if (!synth) { resolve(); return; }
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Elegí una voz en español si el dispositivo la tiene; si no, dejá que el
      // motor elija por el lang.
      const voices = synth.getVoices();
      const es =
        voices.find((v) => /es[-_]?(419|AR|US|MX|ES)/i.test(v.lang)) ||
        voices.find((v) => v.lang?.toLowerCase().startsWith("es"));
      if (es) u.voice = es;
      u.lang = es?.lang || "es-US";
      u.rate = 1.0;
      u.pitch = 1.0;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
      // Red de seguridad: algunos WebViews no disparan onend.
      setTimeout(finish, Math.min(30000, 1200 + text.length * 90));
    } catch {
      resolve();
    }
  });
}

export async function speak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
): Promise<void> {
  if (!text.trim() || isMuted()) {
    onEnd?.();
    return;
  }

  stopSpeaking();

  // 1) Intento ElevenLabs (voz premium) vía backend.
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
    onEnd?.();
    return;
  } catch (e) {
    // 2) Falló ElevenLabs (sin créditos, sin key, o red) → voz nativa del teléfono.
    console.warn("[tts] ElevenLabs no disponible, uso voz nativa:", e);
  }

  onStart?.();
  await speakNative(text);
  onEnd?.();
}

export function isSpeaking(): boolean {
  if (currentAudio !== null && !currentAudio.paused) return true;
  try { return nativeSynth()?.speaking ?? false; } catch { return false; }
}
