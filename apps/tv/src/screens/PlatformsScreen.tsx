// Grid de selección de plataformas navegable con D-pad (control remoto físico)
// y con el teléfono (mismos comandos vía el bridge). 3 columnas × 2 filas + fila
// del botón "Empezar".

import { useEffect, type MutableRefObject } from "react";
import { colorForPlatform } from "../lib/deeplink";
import { cn } from "../lib/tv-utils";
import { useDpad, type DpadBridge } from "../hooks/useDpad";

interface PlatformsScreenProps {
  platforms: string[];
  allPlatforms: string[];
  loading: boolean;
  error: string | null;
  onTogglePlatform: (platform: string) => void;
  onStart: () => void;
  onBack: () => void;
  bridgeRef: MutableRefObject<DpadBridge | null>;
}

const COLS = 3;

export function PlatformsScreen({
  platforms,
  allPlatforms,
  loading,
  error,
  onTogglePlatform,
  onStart,
  onBack,
  bridgeRef,
}: PlatformsScreenProps) {
  // Filas de la grilla (3 por fila) + fila del botón Empezar.
  const gridRows = Math.ceil(allPlatforms.length / COLS);
  const rows = [
    ...Array.from({ length: gridRows }, (_, r) => ({
      id: `r${r}`,
      count: Math.min(COLS, allPlatforms.length - r * COLS),
    })),
    { id: "empezar", count: 1 },
  ];

  const dpad = useDpad({
    rows,
    enabled: !loading,
    onBack,
    onSelect: (rowId, col) => {
      if (rowId === "empezar") {
        onStart();
        return;
      }
      const r = parseInt(rowId.slice(1), 10);
      const idx = r * COLS + col;
      if (allPlatforms[idx]) onTogglePlatform(allPlatforms[idx]);
    },
  });

  useEffect(() => {
    bridgeRef.current = { move: dpad.move, select: dpad.select, setFocus: dpad.setFocus };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, dpad.move, dpad.select, dpad.setFocus]);

  return (
    <div className="tv-safe flex h-screen w-screen flex-col bg-background">
      <h2 className="text-5xl font-bold tracking-tight text-foreground">¿Cuáles tenés?</h2>
      <p className="mt-2 text-xl text-muted-foreground">
        Seleccioná tus plataformas con el control o el teléfono. Si no elegís ninguna, buscamos en todas.
      </p>

      <div className="mt-10 grid grid-cols-3 gap-5">
        {allPlatforms.map((p, i) => {
          const selected = platforms.includes(p);
          const color = colorForPlatform(p);
          const r = Math.floor(i / COLS);
          const c = i % COLS;
          return (
            <button
              key={p}
              onClick={() => onTogglePlatform(p)}
              className={cn(
                "rounded-2xl border-2 px-6 py-8 text-left text-2xl font-semibold transition-all",
                selected ? "border-transparent text-white" : "border-border bg-muted/30 text-foreground",
                dpad.isFocused(`r${r}`, c) && "tv-focus",
              )}
              style={selected ? { backgroundColor: color, borderColor: color } : {}}
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-3 pb-4">
        {error && <p className="text-lg font-semibold text-red-400">{error}</p>}
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/20 border-t-foreground" />
            <p className="text-xl text-muted-foreground">Buscando las mejores opciones...</p>
          </div>
        ) : (
          <button
            onClick={onStart}
            className={cn(
              "rounded-full bg-foreground px-10 py-4 text-2xl font-semibold text-background transition-transform",
              dpad.isFocused("empezar", 0) && "tv-focus",
            )}
          >
            Empezar →
          </button>
        )}
      </div>
    </div>
  );
}
