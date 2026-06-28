// Analytics wrapper liviano.
// Por defecto loguea en console.debug.
// Para activar PostHog: instalá posthog-js, descomentá el bloque de init,
// y agregá VITE_POSTHOG_KEY al .env.local.

type Tracker = { capture: (event: string, props?: Record<string, unknown>) => void };

let tracker: Tracker | null = null;

export function initAnalytics(): void {
  // Posthog opcional — solo se activa si está disponible como global.
  // Para habilitarlo: npm install posthog-js en apps/mobile y descomentar:
  //
  // import posthog from "posthog-js";
  // const key = import.meta.env.VITE_POSTHOG_KEY;
  // if (key) { posthog.init(key, { api_host: "https://app.posthog.com", autocapture: false }); tracker = posthog; }
  //
  // Mientras tanto, los eventos se muestran en console.debug para desarrollo.
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (tracker) {
    tracker.capture(event, props);
  } else {
    console.debug("[analytics]", event, props);
  }
}
