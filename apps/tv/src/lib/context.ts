// copiado de apps/mobile/src/lib/context.ts — mantener en sync a mano
// Contexto temporal para el hemisferio sur (Argentina).

export type DayPart = "madrugada" | "mañana" | "tarde" | "noche";
export type DayType = "semana" | "finde";
export type Season = "verano" | "otoño" | "invierno" | "primavera";

export type AppContext = {
  dayPart: DayPart;
  dayType: DayType;
  season: Season;
  hour: number;
};

export function inferContext(): AppContext {
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDay(); // 0=dom, 6=sab

  const dayPart: DayPart =
    hour >= 0 && hour < 6 ? "madrugada"
    : hour < 12 ? "mañana"
    : hour < 18 ? "tarde"
    : "noche";

  const dayType: DayType = day === 0 || day === 6 ? "finde" : "semana";

  // Hemisferio sur: DJF=verano, MAM=otoño, JJA=invierno, SON=primavera
  const season: Season =
    [12, 1, 2].includes(month) ? "verano"
    : [3, 4, 5].includes(month) ? "otoño"
    : [6, 7, 8].includes(month) ? "invierno"
    : "primavera";

  return { dayPart, dayType, season, hour };
}

export function contextToPromptHint(ctx: AppContext): string {
  const parts: string[] = [];
  if (ctx.dayType === "finde") parts.push("fin de semana");
  else parts.push("día de semana");
  parts.push(`${ctx.dayPart} de ${ctx.season}`);
  return parts.join(", ");
}

export function seasonHintShort(ctx: AppContext): string {
  return `${ctx.season} en el hemisferio sur`;
}
