// Versión mínima de apps/mobile/src/lib/api.ts para el web-control: solo lo
// que necesita el agente conversacional (fetchOrb). Mantener la firma en sync
// a mano con la copia de la app móvil.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://miru-ai.up.railway.app";

// Orbe del control: el usuario habla mirando un título en la TV y el backend
// infiere si es una pregunta sobre ese título o un pedido de búsqueda.
export type OrbResult =
  | { mode: "ask"; answer: string }
  | { mode: "search"; query: string };

export async function fetchOrb(params: {
  transcript: string;
  title: string;
  platform: string;
}): Promise<OrbResult> {
  const res = await fetch(`${API_BASE}/api/orb`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`/api/orb ${res.status}`);
  return res.json() as Promise<OrbResult>;
}
