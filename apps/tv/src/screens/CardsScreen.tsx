// Hero card + fila de alternativas a escala 10-pies, navegable con D-pad
// (control físico) y con el teléfono (mismos comandos vía el bridge).
//
// Filas del dpad:
//   - overlay de fallback abierto → [dismiss]
//   - normal → [actions: "Ver ahora"] arriba, [alts: N posters] abajo
// Enfocar una alternativa la vuelve el hero (preview en vivo, estilo Netflix).

import { useEffect, type MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, Loader2, Smartphone, X } from "lucide-react";
import type { JwResult } from "../lib/justwatch";
import type { DeckItem } from "../lib/media";
import { colorForPlatform, platformLabel } from "../lib/deeplink";
import { getCountry, cn } from "../lib/tv-utils";
import { useDpad, type DpadBridge } from "../hooks/useDpad";

interface CardsScreenProps {
  items: DeckItem[];
  posters: Record<string, string | null>;
  availability: Record<string, JwResult>;
  currentIndex: number;
  onNavigate: (index: number) => void;
  onPlay: (item: DeckItem) => void;
  loading: boolean;
  error: string | null;
  paired: boolean;
  launchHint: { title: string; platform: string } | null;
  onDismissHint: () => void;
  onBack: () => void;
  bridgeRef: MutableRefObject<DpadBridge | null>;
}

export function CardsScreen({
  items,
  posters,
  availability,
  currentIndex,
  onNavigate,
  onPlay,
  loading,
  error,
  paired,
  launchHint,
  onDismissHint,
  onBack,
  bridgeRef,
}: CardsScreenProps) {
  const safeIndex = Math.min(currentIndex, Math.max(0, items.length - 1));
  const current = items[safeIndex];

  // Filas del dpad según haya overlay o no.
  const rows = launchHint
    ? [{ id: "dismiss", count: 1 }]
    : [
        { id: "actions", count: current?.platform ? 1 : 0 },
        { id: "alts", count: items.length },
      ];

  const dpad = useDpad({
    rows,
    enabled: !(loading && items.length === 0),
    onFocusChange: (rowId, col) => {
      // Enfocar una alternativa la vuelve el hero.
      if (rowId === "alts") onNavigate(col);
    },
    onSelect: (rowId, col) => {
      if (rowId === "dismiss") {
        onDismissHint();
      } else if (rowId === "alts") {
        const it = items[col];
        if (it) onPlay(it);
      } else if (rowId === "actions") {
        if (current) onPlay(current);
      }
    },
    onBack: () => {
      if (launchHint) onDismissHint();
      else onBack();
    },
  });

  useEffect(() => {
    bridgeRef.current = { move: dpad.move, select: dpad.select, setFocus: dpad.setFocus };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, dpad.move, dpad.select, dpad.setFocus]);

  if (loading && items.length === 0) {
    return (
      <div className="tv-safe flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-2xl text-muted-foreground">Buscando las mejores opciones...</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="tv-safe flex h-screen w-screen items-center justify-center bg-background">
        <p className="text-2xl text-muted-foreground">Sin resultados.</p>
      </div>
    );
  }

  const poster = posters[current.title];
  const avail = availability[current.title];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < items.length - 1;
  const platformColor = colorForPlatform(current.platform);
  const label = platformLabel(current.platform);

  return (
    <div className="tv-safe relative flex h-screen w-screen flex-col gap-6 bg-background">
      <div className="flex items-center justify-between">
        <div />
        {paired && (
          <span className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-1.5 text-base text-muted-foreground">
            <Smartphone className="h-4 w-4 text-green-400" /> Teléfono conectado
          </span>
        )}
      </div>

      {error && (
        <div className="flex justify-center">
          <div className="rounded-full bg-red-500/90 px-6 py-2 text-lg font-semibold text-white">{error}</div>
        </div>
      )}

      {/* Hero */}
      <div className="flex flex-1 gap-8 overflow-hidden rounded-3xl border border-border bg-muted/20">
        <div className="h-full w-[28%] shrink-0 overflow-hidden">
          {poster ? (
            <img src={poster} alt={current.title} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full animate-pulse bg-muted" />
          )}
        </div>

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
              {[current.type, current.duration, current.year].filter(Boolean).join(" · ")}
            </span>
            {current.ageRating && (
              <span className="rounded border border-muted-foreground/30 px-2 py-1 text-lg font-semibold text-muted-foreground">
                {current.ageRating}
              </span>
            )}
          </div>

          <div>
            {!current.platform ? null : avail === undefined ? (
              <span className="text-lg text-muted-foreground/50">Verificando disponibilidad...</span>
            ) : avail.confirmed ? (
              <span className="text-lg font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
            ) : (
              <span className="text-lg text-muted-foreground/50">Verificalo al abrir la app</span>
            )}
          </div>

          <p className="mt-2 max-w-2xl text-2xl leading-relaxed text-foreground/80">{current.reason}</p>

          {current.platform && (
            <button
              onClick={() => onPlay(current)}
              className={cn(
                "mt-4 w-fit rounded-full px-10 py-4 text-2xl font-bold text-white transition-transform",
                dpad.isFocused("actions", 0) && "tv-focus",
              )}
              style={{ backgroundColor: platformColor }}
            >
              ▶ Ver ahora en {label}
            </button>
          )}
        </div>
      </div>

      {/* Navegación + alternativas */}
      <div className="flex shrink-0 items-center gap-6">
        <button
          onClick={() => onNavigate(safeIndex - 1)}
          disabled={!hasPrev}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-border transition-transform disabled:opacity-20"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>

        <div className="flex flex-1 gap-4 overflow-hidden">
          {items.map((item, i) => {
            const p = posters[item.title];
            const isFocused = dpad.isFocused("alts", i);
            const isCurrent = i === safeIndex;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(i)}
                className={cn(
                  "h-28 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                  isFocused ? "tv-focus border-primary opacity-100" : isCurrent ? "border-primary opacity-100" : "border-transparent opacity-60",
                )}
              >
                {p ? (
                  <img src={p} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted p-1 text-center text-[9px] text-muted-foreground">
                    {item.title}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onNavigate(safeIndex + 1)}
          disabled={!hasNext}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-border transition-transform disabled:opacity-20"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      </div>

      {/* Fallback manual de lanzamiento */}
      {launchHint && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex max-w-2xl flex-col items-center gap-4 rounded-3xl border-2 border-border bg-background px-16 py-12 text-center">
            <span
              className="rounded-full px-5 py-2 text-2xl font-bold text-white"
              style={{ backgroundColor: colorForPlatform(launchHint.platform) }}
            >
              {platformLabel(launchHint.platform)}
            </span>
            <p className="text-3xl font-semibold text-foreground">
              Abrí {platformLabel(launchHint.platform)} en tu TV
            </p>
            <p className="text-2xl text-muted-foreground">
              y buscá <span className="font-semibold text-foreground">«{launchHint.title}»</span>
            </p>
            <button
              onClick={onDismissHint}
              className={cn(
                "mt-4 flex items-center gap-2 rounded-full border-2 border-border px-8 py-3 text-xl font-semibold text-foreground transition-transform",
                dpad.isFocused("dismiss", 0) && "tv-focus",
              )}
            >
              <X className="h-5 w-5" /> Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
