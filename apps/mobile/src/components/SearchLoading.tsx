// Estado de carga de una búsqueda. Aparece INMEDIATAMENTE al disparar (no espera
// al backend). Comunica dos cosas del pedido a-i / a-ii:
//   (i)  ARRIBA: la intención inferida ("lo más importante del pedido") — llega en
//        paralelo vía /api/intent; hasta que llega, mostramos "Entendiendo tu pedido…".
//   (ii) EN EL MEDIO: una rueda girando que cicla las plataformas ("Buscando en X…")
//        para transmitir que ya está barriendo todo el universo de plataformas.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { colorForPlatform } from "../lib/deeplink";

interface SearchLoadingProps {
  query: string;
  platforms: string[];
  type: "auto" | "text" | "voice";
  intent?: string | null;
}

export function SearchLoading({ query, platforms, type, intent }: SearchLoadingProps) {
  const list = platforms.length > 0 ? platforms : ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];
  const [idx, setIdx] = useState(0);

  // Ciclado de plataformas para la rueda del medio.
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 850);
    return () => clearInterval(t);
  }, [list.length]);

  const current = list[idx];
  const color = colorForPlatform(current);

  // (i) Texto de arriba: intención inferida si llegó; si no, el eco literal o un
  // placeholder mientras se infiere.
  const topText =
    type === "auto"
      ? "Eligiendo lo mejor para vos…"
      : intent
        ? intent
        : query.trim()
          ? `«${query}»`
          : "Entendiendo tu pedido…";

  return (
    <div className="fade-in flex h-[100dvh] flex-col items-center justify-center gap-8 bg-background px-8 text-center safe-top safe-bottom">
      {/* (i) Intención inferida, arriba */}
      <div className="flex max-w-sm flex-col items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {intent && type !== "auto" ? "Entendí que querés" : "Tu pedido"}
        </span>
        <p className="flex items-center justify-center gap-1.5 text-lg font-semibold leading-snug text-foreground">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span className={intent ? "text-primary" : ""}>{topText}</span>
        </p>
      </div>

      {/* (ii) Rueda girando que cicla las plataformas */}
      <div className="relative flex h-40 w-40 items-center justify-center">
        {/* Anillo cónico que gira */}
        <div
          className="absolute inset-0 animate-spin rounded-full"
          style={{
            animationDuration: "1.6s",
            background: `conic-gradient(from 0deg, transparent 0deg, ${color} 90deg, transparent 320deg)`,
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
          }}
        />
        {/* Anillo base tenue */}
        <div className="absolute inset-0 rounded-full border-2 border-border/40" />
        {/* Plataforma actual en el centro */}
        <div className="flex flex-col items-center gap-1 px-4">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Buscando en</span>
          <span key={current} className="fade-in text-xl font-bold" style={{ color }}>
            {current}
          </span>
        </div>
      </div>

      {/* Puntitos de progreso por plataforma */}
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
    </div>
  );
}
