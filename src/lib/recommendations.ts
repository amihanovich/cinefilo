export type TimeOption = "30 min" | "1 hora" | "1.5 horas" | "Noche entera";
export type CompanyOption = "Solo" | "En pareja" | "Familia con niños" | "Con amigos";
export type MoodOption =
  | "Algo liviano"
  | "Drama"
  | "Acción"
  | "Documental"
  | "Comedia"
  | "Suspenso"
  | "Épico para relajar";
export type TypeOption = "Película" | "Serie" | "Capítulo de serie";
export type AttentionOption = "Inmersivo" | "De fondo" | "Comfort watch";
export type NoveltyOption = "Algo nuevo" | "Algo conocido" | "Ya visto (rever)";
export type Platform =
  | "Netflix"
  | "Disney+"
  | "Max"
  | "Prime Video"
  | "Apple TV+"
  | "Paramount+"
  | "Star+";

export type FilterValue<T> = T | null; // null = "elegí por mí"

export type SituationFilters = {
  time: FilterValue<TimeOption>;
  company: FilterValue<CompanyOption>;
  mood: FilterValue<MoodOption>;
  type: FilterValue<TypeOption>;
  attention: FilterValue<AttentionOption>;
  novelty: FilterValue<NoveltyOption>;
  platforms: Platform[]; // [] = todas las del usuario
};

export type Recommendation = {
  title: string;
  platform: string;
  duration: string;
  type: string;
  reason: string;
};

export type RecommendationsResult = {
  filters: {
    time: string | null;
    company: string | null;
    mood: string | null;
    type: string | null;
    attention?: string | null;
    novelty?: string | null;
  };
  main: Recommendation;
  alternatives: Recommendation[];
  clarification_needed?: string | null;
};

export const TIME_OPTIONS: TimeOption[] = ["30 min", "1 hora", "1.5 horas", "Noche entera"];
export const COMPANY_OPTIONS: CompanyOption[] = [
  "Solo",
  "En pareja",
  "Familia con niños",
  "Con amigos",
];
export const MOOD_OPTIONS: MoodOption[] = [
  "Algo liviano",
  "Comedia",
  "Drama",
  "Acción",
  "Suspenso",
  "Documental",
  "Épico para relajar",
];
export const TYPE_OPTIONS: TypeOption[] = ["Película", "Serie", "Capítulo de serie"];
export const ATTENTION_OPTIONS: AttentionOption[] = ["Inmersivo", "De fondo", "Comfort watch"];
export const NOVELTY_OPTIONS: NoveltyOption[] = ["Algo nuevo", "Algo conocido", "Ya visto (rever)"];
export const PLATFORM_OPTIONS: Platform[] = [
  "Netflix",
  "Disney+",
  "Max",
  "Prime Video",
  "Apple TV+",
  "Paramount+",
  "Star+",
];

export const PLATFORM_COLORS: Record<Platform, string> = {
  Netflix: "#E50914",
  "Disney+": "#113CCF",
  Max: "#002BE7",
  "Prime Video": "#00A8E1",
  "Apple TV+": "#111111",
  "Paramount+": "#0064FF",
  "Star+": "#1CE783",
};

export function deepLinkFor(platform: string, title: string): string {
  const t = encodeURIComponent(title);
  // Google site-search es más confiable que los buscadores internos
  // (muchos requieren sesión activa y rompen si los abrís desde otro sitio).
  const googleSite = (domain: string) =>
    `https://www.google.com/search?q=${t}+site%3A${domain}&btnI=1`;
  switch (platform) {
    case "Netflix":
      return googleSite("netflix.com");
    case "Disney+":
      return googleSite("disneyplus.com");
    case "Max":
      return googleSite("max.com");
    case "Prime Video":
      return googleSite("primevideo.com");
    case "Apple TV+":
      return googleSite("tv.apple.com");
    case "Paramount+":
      return googleSite("paramountplus.com");
    case "Star+":
      // Star+ se integró en Disney+ (LatAm, 2024)
      return googleSite("disneyplus.com");
    default:
      return `https://www.google.com/search?q=${t}+ver+online`;
  }
}

export function colorForPlatform(platform: string): string {
  return PLATFORM_COLORS[platform as Platform] ?? "#2563EB";
}
