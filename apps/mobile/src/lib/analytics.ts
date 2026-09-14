// Analytics via PostHog.
// Se activa solo si VITE_POSTHOG_KEY está seteada al momento del build;
// sin key, los eventos van a console.debug (modo desarrollo).

import posthog from "posthog-js";

let active = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  posthog.init(key, {
    api_host: "https://us.i.posthog.com",
    autocapture: false,        // solo eventos explícitos via track()
    capture_pageview: false,   // es una SPA de una sola pantalla
    persistence: "localStorage",
  });
  active = true;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (active) {
    posthog.capture(event, props);
  } else {
    console.debug("[analytics]", event, props);
  }
}
