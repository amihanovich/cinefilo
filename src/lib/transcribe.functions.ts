import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Transcripción de voz → texto en el servidor usando Groq (Whisper).
 * El teléfono graba un clip corto, lo manda en base64, y acá lo reenviamos
 * al endpoint de Groq (compatible con OpenAI). Devuelve el texto reconocido.
 *
 * Requiere GROQ_API_KEY en el entorno del servidor.
 */

const inputSchema = z.object({
  // base64 del audio (clip corto). ~8MB de chars ≈ ~6MB de audio: de sobra.
  audioBase64: z.string().min(16).max(8_000_000),
  mimeType: z.string().min(3).max(80),
});

function extFor(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("Falta GROQ_API_KEY en el servidor.");

    const bytes = Buffer.from(data.audioBase64, "base64");
    const blob = new Blob([bytes], { type: data.mimeType });

    const form = new FormData();
    form.append("file", blob, `audio.${extFor(data.mimeType)}`);
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "es");
    form.append("response_format", "json");

    try {
      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[transcribe] Groq HTTP ${res.status}:`, detail.slice(0, 300));
        throw new Error(
          res.status === 401
            ? "La GROQ_API_KEY no es válida."
            : "No pudimos transcribir el audio. Probá de nuevo.",
        );
      }
      const json = (await res.json()) as { text?: string };
      return { text: (json.text ?? "").trim() };
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error("No pudimos transcribir el audio. Probá de nuevo.");
    }
  });
