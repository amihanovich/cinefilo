// Replica de src/lib/context.ts — contexto temporal para el prompt de la IA.

export type DayPart = "mañana" | "mediodía" | "tarde" | "noche" | "madrugada";
export type DayType = "semana" | "finde";
export type Season = "verano" | "otoño" | "invierno" | "primavera";

export type AppContext = {
  dayPart: DayPart;
  dayType: DayType;
  season: Season;
  hour: number;
};

function getSeason(month: number): Season {
  // Hemisferio sur (Argentina)
  if (month >= 12 || month <= 2) return "verano";
  if (month >= 3 && month <= 5) return "otoño";
  if (month >= 6 && month <= 8) return "invierno";
  return "primavera";
}

function getDayPart(hour: number): DayPart {
  if (hour >= 6 && hour < 12) return "mañana";
  if (hour >= 12 && hour < 14) return "mediodía";
  if (hour >= 14 && hour < 20) return "tarde";
  if (hour >= 20 || hour < 1) return "noche";
  return "madrugada";
}

export function inferContext(): AppContext {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay(); // 0=Dom, 6=Sáb
  const month = now.getMonth() + 1;
  return {
    dayPart: getDayPart(hour),
    dayType: dow === 0 || dow === 6 ? "finde" : "semana",
    season: getSeason(month),
    hour,
  };
}

export function contextToPromptHint(ctx: AppContext): string {
  const parts: string[] = [];
  if (ctx.dayType === "finde") parts.push("fin de semana");
  else parts.push("noche de semana");
  parts.push(ctx.dayPart);
  parts.push(ctx.season);
  return parts.join(", ");
}

export function seasonHintShort(ctx: AppContext): string {
  return ctx.season.charAt(0).toUpperCase() + ctx.season.slice(1);
}
