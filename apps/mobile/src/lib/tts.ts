// Text-to-speech proxied por el backend (/api/tts → ElevenLabs).
// La API key de ElevenLabs vive SOLO en el servidor — nunca en el bundle del
// APK, de donde se podría extraer descompilando.
// Devuelve una Promise que resuelve cuando el audio termina.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://cinefilo-production.up.railway.app";

let currentAudio: HTMLAudioElement | null = null;
// Generación de habla: si llega un speak()/stopSpeaking() nuevo, los pasos
// pendientes del anterior (p.ej. el fallback nativo) no deben ejecutarse.
let speakGen = 0;

// Mute global de la voz de Miru (saludo + explicación de resultados).
// Persistido para que la elección del usuario sobreviva entre sesiones.
const MUTE_KEY = "miru:tts_muted";

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
  speakGen++;
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
// calidad es más robótica que ElevenLabs, pero Miru igual te narra.
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
  const gen = ++speakGen;

  // 1) ElevenLabs (voz premium) vía backend, EN STREAMING: audio.src apunta
  //    directo al endpoint GET y el <audio> arranca apenas bufferea el
  //    principio. Antes se descargaba el blob completo y el usuario esperaba
  //    toda la síntesis en silencio. Sin blob tampoco hay objectURL que filtrar.
  const ok = await new Promise<boolean>((resolve) => {
    let settled = false;
    let started = false;
    const audio = new Audio(`${API_BASE}/api/tts?text=${encodeURIComponent(text)}`);
    audio.preload = "auto";
    currentAudio = audio;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      if (currentAudio === audio) currentAudio = null;
      resolve(result);
    };
    // Guard anti-silencio: si en 8s no empezó a sonar (server frío, 4xx/5xx,
    // sin red), caemos a la voz nativa en vez de dejar al usuario esperando.
    const stallTimer = setTimeout(() => {
      if (!started) {
        try { audio.pause(); audio.src = ""; } catch { /* noop */ }
        finish(false);
      }
    }, 8000);
    audio.onplaying = () => {
      if (!started) { started = true; onStart?.(); }
    };
    // Si ya sonó algo, un corte (stopSpeaking / error de red a mitad) cuenta
    // como terminado: NO se repite el texto con la voz nativa.
    audio.onended = () => finish(started);
    audio.onpause = () => finish(started);
    audio.onerror = () => finish(started);
    audio.play().catch(() => finish(started));
  });
  if (ok) {
    onEnd?.();
    return;
  }
  if (gen !== speakGen) {
    // Interrumpido por otro speak()/stopSpeaking(): no hablar el texto viejo.
    onEnd?.();
    return;
  }

  // 2) Falló ElevenLabs (sin créditos, sin key, o red) → voz nativa del teléfono.
  console.warn("[tts] ElevenLabs no disponible, uso voz nativa");
  onStart?.();
  await speakNative(text);
  onEnd?.();
}

export function isSpeaking(): boolean {
  if (currentAudio !== null && !currentAudio.paused) return true;
  try { return nativeSynth()?.speaking ?? false; } catch { return false; }
}
