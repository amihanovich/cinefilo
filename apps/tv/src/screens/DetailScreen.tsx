// Ficha de detalle de un título (referencia: pantalla de detalle de una app de
// streaming). Se llega con OK sobre cualquier póster del home. Navegable con
// D-pad y teléfono.

import { useEffect, type MutableRefObject } from "react";
import { Play, Sparkles } from "lucide-react";
import type { DeckItem } from "../lib/media";
import type { JwResult } from "../lib/justwatch";
import { colorForPlatform, platformLabel } from "../lib/deeplink";
import { getCountry, cn } from "../lib/tv-utils";
import { useDpad, type DpadBridge } from "../hooks/useDpad";

interface DetailScreenProps {
  item: DeckItem;
  poster: string | null | undefined;
  availability: JwResult | undefined;
  onPlay: (item: DeckItem) => void;
  onMoreLikeThis: (item: DeckItem) => void;
  onBack: () => void;
  bridgeRef: MutableRefObject<DpadBridge | null>;
}

export function DetailScreen({
  item,
  poster,
  availability,
  onPlay,
  onMoreLikeThis,
  onBack,
  bridgeRef,
}: DetailScreenProps) {
  const hasPlatform = !!item.platform;
  const dpad = useDpad({
    rows: [{ id: "actions", count: hasPlatform ? 2 : 1 }],
    onBack,
    onSelect: (_rowId, col) => {
      if (hasPlatform && col === 0) onPlay(item);
      else onMoreLikeThis(item);
    },
  });

  useEffect(() => {
    bridgeRef.current = { move: dpad.move, select: dpad.select, setFocus: dpad.setFocus };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, dpad.move, dpad.select, dpad.setFocus]);

  const color = colorForPlatform(item.platform);
  const label = platformLabel(item.platform);
  // Índice de columna del botón "Más como esta" según haya plataforma o no.
  const moreCol = hasPlatform ? 1 : 0;

  return (
    <div className="tv-safe flex h-screen w-screen items-center gap-12 bg-background">
      {/* Póster grande */}
      <div className="h-[80%] w-[32%] shrink-0 overflow-hidden rounded-3xl border border-border bg-muted/20">
        {poster ? (
          <img src={poster} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full animate-pulse bg-muted" />
        )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <h1 className="text-6xl font-bold leading-tight text-foreground">{item.title}</h1>

        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full px-4 py-1.5 text-lg font-bold text-white" style={{ backgroundColor: color }}>
            {label}
          </span>
          <span className="text-xl text-muted-foreground">
            {[item.type, item.duration, item.year].filter(Boolean).join(" · ")}
          </span>
          {item.ageRating && (
            <span className="rounded border border-muted-foreground/30 px-2 py-1 text-lg font-semibold text-muted-foreground">
              {item.ageRating}
            </span>
          )}
        </div>

        <div className="text-lg">
          {!hasPlatform ? null : availability === undefined ? (
            <span className="text-muted-foreground/50">Verificando disponibilidad...</span>
          ) : availability.confirmed ? (
            <span className="font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
          ) : (
            <span className="text-muted-foreground/50">Verificalo al abrir la app</span>
          )}
        </div>

        {item.synopsis && (
          <p className="max-w-3xl text-2xl leading-relaxed text-foreground/85">{item.synopsis}</p>
        )}

        {item.reason && (
          <p className="max-w-3xl text-xl leading-relaxed text-foreground/70">
            <span className="font-semibold text-primary">✦ Por qué te la sugerimos: </span>
            {item.reason}
          </p>
        )}

        <div className="mt-4 flex gap-4">
          {hasPlatform && (
            <button
              onClick={() => onPlay(item)}
              className={cn(
                "flex items-center gap-2 rounded-full px-10 py-4 text-2xl font-bold text-white transition-transform",
                dpad.isFocused("actions", 0) && "tv-focus",
              )}
              style={{ backgroundColor: color }}
            >
              <Play className="h-6 w-6" /> Ver ahora
            </button>
          )}
          <button
            onClick={() => onMoreLikeThis(item)}
            className={cn(
              "flex items-center gap-2 rounded-full border-2 border-border px-10 py-4 text-2xl font-semibold text-foreground transition-transform",
              dpad.isFocused("actions", moreCol) && "tv-focus",
            )}
          >
            <Sparkles className="h-6 w-6 text-primary" /> Más como esta
          </button>
        </div>
      </div>
    </div>
  );
}
