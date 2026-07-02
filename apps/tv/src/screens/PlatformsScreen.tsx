// Grid de selección de plataformas a escala 10-pies.
// TODO(fase 3, Opus): wirear con useDpad para navegación por control remoto —
// por ahora es clickeable con mouse/touch para poder probar en browser.

import { colorForPlatform } from "../lib/deeplink";
import { cn } from "../lib/tv-utils";

interface PlatformsScreenProps {
  platforms: string[];
  allPlatforms: string[];
  loading: boolean;
  error: string | null;
  onTogglePlatform: (platform: string) => void;
  onStart: () => void;
}

export function PlatformsScreen({
  platforms,
  allPlatforms,
  loading,
  error,
  onTogglePlatform,
  onStart,
}: PlatformsScreenProps) {
  return (
    <div className="tv-safe flex h-screen w-screen flex-col bg-background">
      <h2 className="text-5xl font-bold tracking-tight text-foreground">¿Cuáles tenés?</h2>
      <p className="mt-2 text-xl text-muted-foreground">
        Seleccioná tus plataformas. Si no elegís ninguna, buscamos en todas.
      </p>

      <div className="mt-10 grid grid-cols-3 gap-5">
        {allPlatforms.map((p) => {
          const selected = platforms.includes(p);
          const color = colorForPlatform(p);
          return (
            <button
              key={p}
              onClick={() => onTogglePlatform(p)}
              className={cn(
                "tv-focus rounded-2xl border-2 px-6 py-8 text-left text-2xl font-semibold transition-all",
                selected ? "border-transparent text-white" : "border-border bg-muted/30 text-foreground",
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
            className="tv-focus rounded-full bg-foreground px-10 py-4 text-2xl font-semibold text-background transition-transform"
          >
            Empezar →
          </button>
        )}
      </div>
    </div>
  );
}
