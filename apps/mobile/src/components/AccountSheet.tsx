// Panel "Mi cuenta" para la app mobile.
// Modo guest: todo en localStorage. Sin Supabase auth por ahora.

import { useEffect, useState } from "react";
import { X, ChevronLeft, ExternalLink } from "lucide-react";
import { colorForPlatform, platformLabel, deepLinkFor } from "../lib/deeplink";
import { fetchPostersClient } from "../lib/posters";

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];
const PLATFORMS_KEY = "queveo:guest:default_platforms";
const WATCHLIST_KEY = "cinefilo:watchlist";
const LIKED_KEY = "cinefilo:liked";
const COUNTRY_KEY = "cinefilo:country";

type WatchlistItem = { title: string; platform: string; type?: string };
type LikedItem = { title: string; platform: string; type?: string };

function loadPlatforms(): string[] {
  try { return JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]") as string[]; }
  catch { return []; }
}

function savePlatforms(p: string[]): void {
  localStorage.setItem(PLATFORMS_KEY, JSON.stringify(p));
}

function loadWatchlist(): WatchlistItem[] {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]") as WatchlistItem[]; }
  catch { return []; }
}

function loadLiked(): LikedItem[] {
  try { return JSON.parse(localStorage.getItem(LIKED_KEY) ?? "[]") as LikedItem[]; }
  catch { return []; }
}

type Section = "main" | "watchlist" | "liked";

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
  onPlatformsChange?: (platforms: string[]) => void;
}

export function AccountSheet({ open, onClose, onPlatformsChange }: AccountSheetProps) {
  const [platforms, setPlatforms] = useState<string[]>(loadPlatforms);
  const [section, setSection] = useState<Section>("main");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [liked, setLiked] = useState<LikedItem[]>([]);
  const country = localStorage.getItem(COUNTRY_KEY) ?? "AR";

  useEffect(() => {
    if (open) {
      setPlatforms(loadPlatforms());
      setWatchlist(loadWatchlist());
      setLiked(loadLiked());
      setSection("main");
    }
  }, [open]);

  const togglePlatform = (p: string) => {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    setPlatforms(next);
    savePlatforms(next);
    onPlatformsChange?.(next);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-background shadow-2xl safe-top safe-bottom">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          {section !== "main" ? (
            <button
              onClick={() => setSection("main")}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:scale-90 transition-transform"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
            <div className="h-8 w-8" />
          )}
          <h2 className="flex-1 text-center text-base font-bold text-foreground">
            {section === "main" ? "Mi cuenta" : section === "watchlist" ? "Ver luego" : "Me gustó"}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:scale-90 transition-transform"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {section === "main" && (
            <MainSection
              platforms={platforms}
              onToggle={togglePlatform}
              watchlistCount={watchlist.length}
              likedCount={liked.length}
              country={country}
              onOpenWatchlist={() => setSection("watchlist")}
              onOpenLiked={() => setSection("liked")}
            />
          )}
          {section === "watchlist" && <ItemGallery items={watchlist} emptyText="Nada guardado todavía." />}
          {section === "liked" && <ItemGallery items={liked} emptyText="Todavía no marcaste nada." />}
        </div>
      </div>
    </>
  );
}

/* ─── Sección principal ─────────────────────────────────────────────────── */

function MainSection({
  platforms,
  onToggle,
  watchlistCount,
  likedCount,
  country,
  onOpenWatchlist,
  onOpenLiked,
}: {
  platforms: string[];
  onToggle: (p: string) => void;
  watchlistCount: number;
  likedCount: number;
  country: string;
  onOpenWatchlist: () => void;
  onOpenLiked: () => void;
}) {
  return (
    <div className="space-y-8">
      {/* Plataformas */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Mis plataformas
        </h3>
        <p className="mb-4 text-xs text-muted-foreground/70">
          Usadas en cada búsqueda. Si no elegís ninguna, busca en todas.
        </p>
        <div className="flex flex-col gap-2">
          {PLATFORMS.map((p) => {
            const active = platforms.includes(p);
            const color = colorForPlatform(p);
            return (
              <button
                key={p}
                onClick={() => onToggle(p)}
                className="flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-all active:scale-[0.98]"
                style={
                  active
                    ? { borderColor: color, backgroundColor: `${color}18` }
                    : { borderColor: "transparent", backgroundColor: "var(--color-muted)" }
                }
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: active ? color : "var(--color-muted-foreground)", opacity: active ? 1 : 0.3 }}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: active ? color : undefined }}
                >
                  {platformLabel(p)}
                </span>
                {active && (
                  <span className="ml-auto text-[10px] font-bold" style={{ color }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Actividad */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Mi actividad
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Ver luego"
            count={watchlistCount}
            emoji="🔖"
            onClick={onOpenWatchlist}
          />
          <StatCard
            label="Me gustó"
            count={likedCount}
            emoji="👍"
            onClick={onOpenLiked}
          />
        </div>
      </section>

      {/* Región */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Región detectada
        </h3>
        <div className="rounded-2xl bg-muted px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{country}</span>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            Usada para verificar disponibilidad
          </p>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  count,
  emoji,
  onClick,
}: {
  label: string;
  count: number;
  emoji: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      className="flex flex-col items-center gap-1.5 rounded-2xl bg-muted py-5 transition-all active:scale-95 disabled:opacity-40"
    >
      <span className="text-2xl">{emoji}</span>
      <span className="text-xl font-bold text-foreground">{count}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  );
}

/* ─── Galería de items ──────────────────────────────────────────────────── */

function ItemGallery({ items, emptyText }: { items: (WatchlistItem | LikedItem)[]; emptyText: string }) {
  const [posters, setPosters] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (items.length === 0) return;
    void fetchPostersClient(
      items.map((i) => ({ title: i.title, type: i.type ?? "Película" }))
    ).then(setPosters);
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground/60">{emptyText}</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const color = colorForPlatform(item.platform);
        const poster = posters[item.title];
        const link = deepLinkFor(item.platform, item.title);
        return (
          <div key={item.title} className="overflow-hidden rounded-2xl bg-muted">
            <div className="relative h-28 w-full" style={!poster ? { backgroundColor: `${color}18` } : undefined}>
              {poster ? (
                <img src={poster} alt={item.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-4xl font-black opacity-10" style={{ color }}>
                    {item.title.charAt(0)}
                  </span>
                </div>
              )}
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground">
                {item.title}
              </p>
              {item.platform && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-muted-foreground/60">{platformLabel(item.platform)}</span>
                </div>
              )}
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-1 text-[10px] font-semibold"
                style={{ color }}
              >
                <ExternalLink className="h-2.5 w-2.5" />
                Ver ahora
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
