// Fetch con timeout + retry para las llamadas salientes del backend
// (Anthropic, Groq, ElevenLabs). Módulo Node autónomo (no depende del bundle).
// Antes ninguna llamada tenía timeout: un upstream colgado dejaba el request
// del server zombie aunque el cliente ya hubiera abortado.

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ timeoutMs?: number, retries?: number }} [cfg]
 * @returns {Promise<Response>}
 */
export async function fetchUpstream(url, options, cfg) {
  const timeoutMs = (cfg && cfg.timeoutMs) || 30000;
  const retries = cfg && typeof cfg.retries === "number" ? cfg.retries : 1;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      // 5xx / 429: transitorios típicos → un reintento corto.
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        lastErr = new Error("HTTP " + res.status);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      // Timeout: no reintentar (ya se esperó demasiado; el cliente suele haber abortado).
      if (e && (e.name === "TimeoutError" || e.name === "AbortError")) throw e;
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
