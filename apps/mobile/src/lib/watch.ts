// "Ver ahora en X": la única salida de Miru hacia la plataforma de destino.
// Vivía inline en wizard.tsx; se extrajo acá para que la app conversacional y el
// wizard completo abran los títulos EXACTAMENTE igual (una sola copia de la
// cascada de fallbacks, que es la parte delicada).

import { track } from "./analytics";
import { openNative, openInApp, type JwResult } from "./justwatch";
import { recordOpened, type OpenedItem } from "./opened";

export type Watchable = { title: string; platform: string; type: string; year?: string };

/** URL de búsqueda dentro de cada plataforma (fallback cuando no hay deeplink). */
const SEARCH_URLS: Record<string, (q: string) => string> = {
  Netflix: (q) => `https://www.netflix.com/search?q=${q}`,
  "Prime Video": (q) => `https://www.primevideo.com/search/?phrase=${q}`,
  "Disney+": () => `https://www.disneyplus.com/search`,
  "Star+": () => `https://www.disneyplus.com/search`,
  Max: (q) => `https://play.max.com/search?q=${q}`,
  "Apple TV+": (q) => `https://tv.apple.com/search?term=${q}`,
  "Paramount+": (q) => `https://www.paramountplus.com/search/${q}/`,
};

/**
 * Abre el título en su plataforma. Cascada:
 *   1. Disponibilidad confirmada por JustWatch → deeplink/app exactos.
 *   2. JustWatch verificó y NO está ahí → búsqueda neutral de dónde verlo
 *      (abrir la app igual era mandar al usuario a un "sin resultados").
 *   3. Sin verificar → se abre la app de la plataforma (o su web) buscando el título.
 * Registra la apertura en "Abiertos recientemente" ANTES de salir de la app.
 */
export async function openStreaming(
  current: Watchable,
  avail: JwResult | undefined,
  opts?: { posterUrl?: string | null; onOpened?: (list: OpenedItem[]) => void },
): Promise<void> {
  track("watch_now_tapped", {
    title: current.title,
    platform: current.platform,
    availability_confirmed: !!avail?.confirmed,
  });
  const remember = (via: "deeplink" | "app-search" | "web" | "google") => {
    const list = recordOpened(
      {
        title: current.title,
        platform: current.platform,
        type: current.type,
        year: current.year,
        posterUrl: opts?.posterUrl ?? undefined,
      },
      { via, confirmed: !!avail?.confirmed },
    );
    opts?.onOpened?.(list);
  };

  if (avail?.confirmed) {
    remember("deeplink");
    if (await openNative(avail)) return;
  }

  const q = encodeURIComponent(current.title);

  if (avail && !avail.confirmed) {
    remember("google");
    window.open(`https://www.google.com/search?q=${q}+ver+online`, "_system");
    return;
  }
  if (!avail) remember("app-search");
  const webUrl = SEARCH_URLS[current.platform]?.(q) ?? `https://www.google.com/search?q=${q}+ver+online`;
  // Abre la app nativa (scheme/App Link) si está instalada; sino, web.
  void openInApp(current.platform, webUrl, current.title);
}
