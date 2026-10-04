// Colores de marca por plataforma de streaming (copia de apps/mobile).

export const PLATFORM_COLORS: Record<string, string> = {
  Netflix: "#E50914",
  "Disney+": "#0063E5",
  // Max volvió a ser HBO Max (2025): su marca es negra.
  Max: "#000000",
  "Prime Video": "#00A8E1",
  "Apple TV+": "#1D1D1F", // casi negro de Apple: no se confunde con Max
  "Paramount+": "#0064FF",
  // Universal+ es amarilla (como su favicon). El texto encima lo decide la
  // luminancia: sobre amarillo va en tinta, no en blanco.
  "Universal+": "#FFC20E",
  "Star+": "#0063E5",
};

export function colorForPlatform(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "#6d28d9";
}

export function platformLabel(platform: string): string {
  if (platform === "Star+") return "Disney+";
  return platform;
}

/**
 * Color de texto legible sobre el color de una plataforma: blanco en las
 * oscuras, tinta en las claras (amarillo de Universal+, celeste de Prime).
 * Copia de apps/mobile/src/lib/deeplink.ts — mantener en sync.
 */
export function textOnPlatform(platform: string): string {
  const hex = colorForPlatform(platform).replace("#", "");
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  return lum > 0.3 ? "#1A1614" : "#FFFFFF";
}
