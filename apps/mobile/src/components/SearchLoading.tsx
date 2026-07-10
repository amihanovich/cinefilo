// Estado de carga de una búsqueda. Aparece INMEDIATAMENTE al disparar la búsqueda
// (no espera nada del backend): línea 1 = plataformas activas del usuario; línea 2
// = eco de lo que pidió (Opción C — texto literal entre «»). Reemplaza la UI de
// resultado mientras la IA procesa; entra con un fade-in suave.

import { Loader2, Sparkles } from "lucide-react";

function formatPlatforms(platforms: string[]): string {
  const list = platforms.length > 0 ? platforms : ["todas las plataformas"];
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

interface SearchLoadingProps {
  query: string;
  platforms: string[];
  type: "auto" | "text" | "voice";
}

export function SearchLoading({ query, platforms, type }: SearchLoadingProps) {
  return (
    <div className="fade-in flex h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-8 text-center safe-top safe-bottom">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />

      <div className="flex flex-col gap-2">
        {/* Línea 1: plataformas activas (inmediata, ≤100ms) */}
        <p className="text-sm text-muted-foreground">
          Buscando en <span className="font-semibold text-foreground">{formatPlatforms(platforms)}</span>…
        </p>
        {/* Línea 2: eco de la intención (texto literal del usuario) */}
        <p className="flex items-center justify-center gap-1.5 text-base font-medium text-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          {type === "auto" ? (
            <span>Eligiendo lo mejor para vos…</span>
          ) : (
            <span>Buscando para <span className="text-primary">«{query}»</span></span>
          )}
        </p>
      </div>

      {/* Skeleton del card que va a aparecer */}
      <div className="mt-2 flex w-full max-w-xs gap-2 text-left">
        <div className="h-24 w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div className="flex flex-1 flex-col gap-2 py-1">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-auto h-6 w-full animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    </div>
  );
}
