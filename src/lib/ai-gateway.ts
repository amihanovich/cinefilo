import { createAnthropic } from "@ai-sdk/anthropic";

// baseURL explícito: la versión instalada de @ai-sdk/anthropic arma la URL como
// `${baseURL}/messages` y por defecto omite el `/v1`, pegándole a
// https://api.anthropic.com/messages → 404 Not Found. Fijamos el endpoint correcto.
export const createAiProvider = (apiKey: string) =>
  createAnthropic({ apiKey, baseURL: "https://api.anthropic.com/v1" });
