// Hero card + fila de alternativas a escala 10-pies.
// TODO(fase 3, Opus): wirear con useDpad para navegación por control remoto físico.
// TODO(fase 5, Opus): "Ver ahora" debe usar tv-launcher.ts (packages de TV,
// no los del móvil) — por ahora es un placeholder sin acción real.

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { Recommendation } from "../lib/api";
import type { JwResult } from "../lib/justwatch";
import { colorForPlatform, platformLabel } from "../lib/deeplink";
import { getCountry, cn } from "../lib/tv-utils";

interface CardsScreenProps {
  items: Recommendation[];
  posters: Record<string, string | null>;
  availability: Record<string, JwResult>;
  currentIndex: number;
  onNavigate: (index: number) => void;
  loading: boolean;
  error: string | null;
}

export function CardsScreen({
  items,
  posters,
  availability,
  currentIndex,
  onNavigate,
  loading,
  error,
}: CardsScreenProps) {
  if (loading && items.length === 0) {
    return (
      <div className="tv-safe flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-2xl text-muted-foreground">Buscando las mejores opciones...</p>
      </div>
    );
  }

  const safeIndex = Math.min(currentIndex, Math.max(0, items.length - 1));
  const current = items[safeIndex];
  const poster = current ? posters[current.title] : undefined;
  const avail = current ? availability[current.title] : undefined;
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < items.length - 1;
  const platformColor = current ? colorForPlatform(current.platform) : "#888";
  const label = current ? platformLabel(current.platform) : "";

  if (!current) {
    return (
      <div className="tv-safe flex h-screen w-screen items-center justify-center bg-background">
        <p className="text-2xl text-muted-foreground">Sin resultados.</p>
      </div>
    );
  }

  return (
    <div className="tv-safe flex h-screen w-screen flex-col gap-6 bg-background">
      {error && (
        <div className="flex justify-center">
          <div className="rounded-full bg-red-500/90 px-6 py-2 text-lg font-semibold text-white">{error}</div>
        </div>
      )}

      {/* Hero */}
      <div className="flex flex-1 gap-8 overflow-hidden rounded-3xl border border-border bg-muted/20">
        {/* Poster */}
        <div className="h-full w-[28%] shrink-0 overflow-hidden">
          {poster ? (
            <img src={poster} alt={current.title} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full animate-pulse bg-muted" />
          )}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 py-8 pr-10">
          <h2 className="text-5xl font-bold leading-tight text-foreground">{current.title}</h2>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className="rounded-full px-4 py-1.5 text-lg font-bold text-white"
              style={{ backgroundColor: platformColor }}
            >
              {label}
            </span>
            <span className="text-xl text-muted-foreground">
              {current.type} · {current.duration}
              {current.year && ` · ${current.year}`}
            </span>
            {current.ageRating && (
              <span className="rounded border border-muted-foreground/30 px-2 py-1 text-lg font-semibold text-muted-foreground">
                {current.ageRating}
              </span>
            )}
          </div>

          <div>
            {avail === undefined ? (
              <span className="text-lg text-muted-foreground/50">Verificando disponibilidad...</span>
            ) : avail.confirmed ? (
              <span className="text-lg font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
            ) : (
              <span className="text-lg text-muted-foreground/50">Verificalo al abrir la app</span>
            )}
          </div>

          <p className="mt-2 max-w-2xl text-2xl leading-relaxed text-foreground/80">{current.reason}</p>

          <button
            className="tv-focus mt-4 w-fit rounded-full px-10 py-4 text-2xl font-bold text-white transition-transform"
            style={{ backgroundColor: platformColor }}
          >
            ▶ Ver ahora en {label}
          </button>
        </div>
      </div>

      {/* Navegación + alternativas */}
      <div className="flex shrink-0 items-center gap-6">
        <button
          onClick={() => onNavigate(safeIndex - 1)}
          disabled={!hasPrev}
          className="tv-focus flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-border transition-transform disabled:opacity-20"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>

        <div className="flex flex-1 gap-4 overflow-hidden">
          {items.map((item, i) => {
            const p = posters[item.title];
            const isCurrent = i === safeIndex;
            return (
              <button
                key={item.title}
                onClick={() => onNavigate(i)}
                className={cn(
                  "tv-focus h-28 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                  isCurrent ? "border-primary" : "border-transparent opacity-60",
                )}
              >
                {p ? (
                  <img src={p} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full animate-pulse bg-muted" />
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onNavigate(safeIndex + 1)}
          disabled={!hasNext}
          className="tv-focus flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-border transition-transform disabled:opacity-20"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      </div>
    </div>
  );
}
