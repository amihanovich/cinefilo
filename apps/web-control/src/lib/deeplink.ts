// Colores de marca por plataforma de streaming (copia de apps/mobile).

export const PLATFORM_COLORS: Record<string, string> = {
  Netflix: "#E50914",
  "Disney+": "#0063E5",
  Max: "#002BE7",
  "Prime Video": "#00A8E1",
  "Apple TV+": "#000000",
  "Paramount+": "#0064FF",
  // Navy: se distingue de los otros azules por oscuro (ver lib/deeplink.ts del móvil).
  "Universal+": "#1D2E6B",
  "Star+": "#0063E5",
};

export function colorForPlatform(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "#6d28d9";
}

export function platformLabel(platform: string): string {
  if (platform === "Star+") return "Disney+";
  return platform;
}
