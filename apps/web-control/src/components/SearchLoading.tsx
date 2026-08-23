// Rueda de búsqueda (portada de apps/mobile/src/components/SearchLoading.tsx —
// mantener en sync a mano, como el resto de las copias del control).
// Acá es un OVERLAY sobre el control: aparece al disparar una búsqueda en la TV.
// Antes el web-control no daba NINGÚN feedback y encima la UI quedaba gris
// (la TV manda SCREEN con items vacíos mientras busca y los botones se
// deshabilitaban sin explicación). También sirve como rueda de "Abriendo
// <plataforma>…" al dar Play (fixedPlatform).

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { colorForPlatform, platformLabel } from "../lib/deeplink";

interface SearchLoadingProps {
  query: string;
  platforms: string[];
  /** Si viene, la rueda no cicla: modo "Abriendo X…" (Play). */
  fixedPlatform?: string;
  headline?: string;
}

export function SearchLoading({ query, platforms, fixedPlatform, headline }: SearchLoadingProps) {
  const list = fixedPlatform
    ? [fixedPlatform]
    : platforms.length > 0
      ? platforms
      : ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (list.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 850);
    return () => clearInterval(t);
  }, [list.length]);

  const current = list[idx % list.length];
  const color = colorForPlatform(current);

  return (
    <div className="fixed inset-0 z-[65] flex flex-col items-center justify-center gap-8 bg-background px-8 text-center">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <p className="flex items-center justify-center gap-1.5 text-lg font-semibold leading-snug text-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          {headline ?? (query.trim() ? `«${query}»` : "Buscando lo mejor para vos…")}
        </p>
      </div>

      <div className="relative flex h-40 w-40 items-center justify-center">
        <div
          className="absolute inset-0 animate-spin rounded-full"
          style={{
            animationDuration: "1.6s",
            background: `conic-gradient(from 0deg, transparent 0deg, ${color} 90deg, transparent 320deg)`,
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
          }}
        />
        <div className="absolute inset-0 rounded-full border-2 border-border/40" />
        <div className="flex flex-col items-center gap-1 px-4">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {fixedPlatform ? "Abriendo" : "Buscando en"}
          </span>
          <span key={current} className="text-xl font-bold" style={{ color }}>
            {platformLabel(current)}
          </span>
        </div>
      </div>

      {list.length > 1 && (
        <div className="flex items-center gap-1.5">
          {list.map((p, i) => (
            <span
              key={p}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === idx ? "16px" : "6px",
                background: i === idx ? colorForPlatform(p) : "hsl(var(--muted-foreground) / 0.3)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
