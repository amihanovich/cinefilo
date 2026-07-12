// TTS via ElevenLabs, proxied por el servidor para NO exponer la API key en el
// bundle del cliente (la clave en el APK se puede extraer descompilando).
// Módulo Node autónomo para server-node.mjs.

import { fetchUpstream } from "./upstream.mjs";

const DEFAULT_VOICE = "ErXwobaYiN019PkySvjV"; // Antoni: cálida, multilingual
const MODEL = "eleven_multilingual_v2";

function requestInit(text, key) {
  return {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(text).slice(0, 1200), // cap defensivo de largo
      model_id: MODEL,
      voice_settings: {
        stability: 0.72, // más alto = menos variación al inicio, elimina el "ehh"
        similarity_boost: 0.82,
        style: 0.0, // 0 evita que la voz "improvise" pausas o rellenos
        use_speaker_boost: true,
      },
    }),
  };
}

/**
 * TTS en streaming: devuelve la Response de ElevenLabs (endpoint /stream) para
 * pipear el MP3 al cliente A MEDIDA que se sintetiza. Antes se esperaba el
 * buffer completo y el usuario no oía nada hasta el final de la síntesis.
 * @param {string} text
 * @returns {Promise<Response>} body = audio/mpeg en streaming
 */
export async function ttsStream(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY en el servidor.");
  if (!text || !String(text).trim()) throw new Error("Texto vacío.");

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const res = await fetchUpstream(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    requestInit(text, key),
    // El timeout acota TODO el stream (no solo los headers): 45s alcanza de
    // sobra para 65 palabras y evita conexiones colgadas indefinidamente.
    { timeoutMs: 45000 },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 160)}`);
  }
  return res;
}

/**
 * Genera audio MP3 completo (compat con llamadores que necesiten el Buffer).
 * @param {string} text
 * @returns {Promise<Buffer>} audio/mpeg
 */
export async function ttsAudio(text) {
  const res = await ttsStream(text);
  return Buffer.from(await res.arrayBuffer());
}
