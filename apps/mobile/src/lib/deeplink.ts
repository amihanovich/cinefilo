// Colores de marca y deep links para cada plataforma de streaming.

export const PLATFORM_COLORS: Record<string, string> = {
  Netflix: "#E50914",
  "Disney+": "#0063E5",
  Max: "#002BE7",
  "Prime Video": "#00A8E1",
  "Apple TV+": "#000000",
  "Paramount+": "#0064FF",
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
