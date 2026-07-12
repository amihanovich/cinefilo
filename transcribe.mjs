import { fetchUpstream } from "./upstream.mjs";

// Transcripción de audio via Groq Whisper. Módulo Node autónomo para server-node.mjs.
// Recibe un Buffer con audio (webm/ogg/mp4) y devuelve el texto transcripto en español.

export async function transcribeAudio(audioBuffer, mimeType) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Falta GROQ_API_KEY en el servidor.");

  // Node 18+ tiene FormData nativo
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });
  formData.append("file", blob, "audio.webm");
  formData.append("model", "whisper-large-v3");
  formData.append("language", "es");
  formData.append("response_format", "json");

  const res = await fetchUpstream("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: formData,
  }, { timeoutMs: 45000 });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return { text: (data.text || "").trim() };
}
