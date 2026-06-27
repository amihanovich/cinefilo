// Universal Links para abrir la app de streaming nativa en iOS/Android.
// iOS (Universal Links) y Android (App Links) interceptan estas URLs HTTPS
// y abren la app instalada automáticamente. Sin custom schemes ni timeouts.

export const PLATFORM_COLORS: Record<string, string> = {
  Netflix: "#E50914",
  "Disney+": "#113CCF",
  Max: "#002BE7",
  "Prime Video": "#00A8E1",
  "Apple TV+": "#111111",
  "Paramount+": "#0064FF",
  "Star+": "#1CE783",
};

export function colorForPlatform(platform: string): string {
  return PLATFORM_COLORS[platform] ?? "#2563EB";
}

export function deepLinkFor(platform: string, title: string): string {
  const t = encodeURIComponent(title);
  switch (platform) {
    case "Netflix":
      return `https://www.netflix.com/search?q=${t}`;
    case "Disney+":
    case "Star+":
      return `https://www.disneyplus.com/search`;
    case "Max":
      return `https://play.max.com/search?q=${t}`;
    case "Prime Video":
      return `https://www.primevideo.com/search/?phrase=${t}`;
    case "Apple TV+":
      return `https://tv.apple.com/search?term=${t}`;
    case "Paramount+":
      return `https://www.paramountplus.com/search/${t}/`;
    default:
      return `https://www.google.com/search?q=${t}+ver+online`;
  }
}

export function platformLabel(platform: string): string {
  return platform === "Star+" ? "Disney+" : platform;
}
