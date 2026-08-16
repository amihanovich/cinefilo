// Migración de claves de localStorage del rebranding Cinefilo → Miru.
// Se corre UNA vez al boot (main.tsx): copia el valor viejo a la clave nueva
// solo si la nueva no existe. Las claves viejas se dejan (rollback barato).
const LEGACY_KEYS: Array<[oldKey: string, newKey: string]> = [
  ["cinefilo:web-mylist", "miru:web-mylist"],
  ["cinefilo:web-liked", "miru:web-liked"],
  ["cinefilo:web-disliked", "miru:web-disliked"],
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
    // storage inaccesible: el control funciona igual, sin persistencia
  }
}
