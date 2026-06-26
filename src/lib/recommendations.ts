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
  year?: string;       // ej: "2019"
  ageRating?: string;  // "ATP" | "PG" | "+13" | "+16" | "+18"
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
  cinephile_note?: string | null;
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
  // Universal Links: iOS y Android interceptan estas URLs HTTPS y abren
  // la app nativa automáticamente si está instalada. Si no está, abre el browser.
  // Star+ fue absorbido por Disney+ en LatAm en 2024.
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

export function colorForPlatform(platform: string): string {
  return PLATFORM_COLORS[platform as Platform] ?? "#2563EB";
}
