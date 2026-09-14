// Migración de claves de localStorage del rebranding Cinefilo → Miru.
// Se corre UNA vez al boot (main.tsx), antes de que cualquier módulo lea storage:
// copia el valor viejo a la clave nueva solo si la nueva no existe todavía.
// Las claves viejas se dejan (rollback barato); borrarlas queda para una ronda futura.
const LEGACY_KEYS: Array<[oldKey: string, newKey: string]> = [
  ["cinefilo:watchlist", "miru:watchlist"],
  ["cinefilo:liked", "miru:liked"],
  ["cinefilo:disliked", "miru:disliked"],
  ["cinefilo:country", "miru:country"],
  ["queveo:guest:default_platforms", "miru:platforms"],
  ["cinefilo:tvBannerDismissed", "miru:tvBannerDismissed"],
  ["cinefilo:opened_before", "miru:opened_before"],
  ["cinefilo:tv-session", "miru:tv-session"],
  ["cinefilo:tts_muted", "miru:tts_muted"],
];

export function migrateLegacyStorage() {
  try {
    for (const [oldKey, newKey] of LEGACY_KEYS) {
      if (localStorage.getItem(newKey) === null) {
        const old = localStorage.getItem(oldKey);
        if (old !== null) localStorage.setItem(newKey, old);
      }
    }
  } catch {
    // storage inaccesible (modo privado extremo): la app funciona igual, sin persistencia
  }
}
