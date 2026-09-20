// Colores de marca y deep links para cada plataforma de streaming.

export const PLATFORM_COLORS: Record<string, string> = {
  Netflix: "#E50914",
  "Disney+": "#0063E5",
  Max: "#002BE7",
  "Prime Video": "#00A8E1",
  "Apple TV+": "#000000",
  "Paramount+": "#0064FF",
  // Navy: los otros azules de la paleta son vivos (Disney+, Max, Paramount+),
  // así que Universal+ se distingue por oscuro sin pisar el negro de Apple TV+.
  "Universal+": "#1D2E6B",
  "Star+": "#0063E5", // absorbido por Disney+ en LatAm
};

export function colorForPlatform(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "#6d28d9";
}

// Star+ fue fusionado con Disney+ en LatAm (2024)
export function platformLabel(platform: string): string {
  if (platform === "Star+") return "Disney+";
  return platform;
}

export function deepLinkFor(platform: string, title: string): string {
  const q = encodeURIComponent(title);
  const urls: Record<string, string> = {
    Netflix: `https://www.netflix.com/search?q=${q}`,
    "Prime Video": `https://www.primevideo.com/search/?phrase=${q}`,
    "Disney+": `https://www.disneyplus.com/search`,
    "Star+": `https://www.disneyplus.com/search`,
    Max: `https://play.max.com/search?q=${q}`,
    "Apple TV+": `https://tv.apple.com/search?term=${q}`,
    "Paramount+": `https://www.paramountplus.com/search/${q}/`,
  };
  return urls[platform] ?? `https://www.google.com/search?q=${q}+streaming`;
}

/**
 * Color de texto legible sobre el color de una plataforma. Casi todas son
 * oscuras y llevan blanco, pero el celeste de Prime Video con blanco da 2.7:1
 * (abajo de AA) — sobre él el texto va en tinta. Se decide por luminancia, así
 * que sirve igual si mañana cambia un color de marca.
 */
export function textOnPlatform(platform: string): string {
  const hex = colorForPlatform(platform).replace("#", "");
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  // Umbral 0.3: por encima, el blanco no llega a 4.5:1.
  return lum > 0.3 ? "#1A1614" : "#FFFFFF";
}
