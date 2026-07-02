// Adaptado de apps/mobile/src/lib/analytics.ts — mismo PostHog, eventos
// etiquetados con app:"tv" para distinguirlos de los del móvil en el dashboard.

import posthog from "posthog-js";

let active = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  posthog.init(key, {
    api_host: "https://us.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    persistence: "localStorage",
  });
  active = true;
}

export function track(event: string, props?: Record<string, unknown>): void {
  const payload = { ...props, app: "tv" };
  if (active) {
    posthog.capture(event, payload);
  } else {
    console.debug("[analytics]", event, payload);
  }
}
