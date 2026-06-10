import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Tv, Smartphone, Play, Search } from "lucide-react";
import { useTvChannel } from "@/lib/use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "@/lib/tv-protocol";
import { recommendFromText } from "@/lib/recommendations.functions";
import {
  PLATFORM_OPTIONS,
  colorForPlatform,
  deepLinkFor,
  type Platform,
} from "@/lib/recommendations";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import { fetchPostersClient } from "@/lib/itunes";

export const Route = createFileRoute("/tv")({
  component: TvPage,
});

type Screen = "home" | "search" | "detail" | "player";

/** Columnas de la grilla de resultados (define el salto vertical del D-pad). */
const GRID_COLS = 4;
/** Tope de ítems acumulados con la carga infinita (evita crecer sin fin). */
const MAX_ITEMS = 60;

type Rec = {
  title: string;
  platform: string;
  type: string;
  year?: string;
  synopsis?: string;
  reason?: string;
};

/** Convierte recomendaciones de la IA a MediaItem, con ids únicos correlativos. */
function recsToItems(recs: Rec[], startIndex: number): MediaItem[] {
  return recs.map((r, i) => {
    const yearNum = r.year ? Number.parseInt(r.year, 10) : NaN;
    return {
      id: `m${startIndex + i}`,
      title: r.title,
      platform: r.platform,
      year: Number.isFinite(yearNum) ? yearNum : undefined,
      synopsis: r.synopsis,
      reason: r.reason,
    };
  });
}

/**
 * Id de sesión corto. No usamos crypto.randomUUID() porque solo existe en
 * contextos seguros (HTTPS o localhost): al abrir la TV por IP de LAN sobre
 * http —necesario para escanear el QR desde un celu— no está disponible.
 * crypto.getRandomValues() sí funciona en http, con fallback a Math.random().
 */
function makeSessionId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 10);
}

function TvPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [controlUrl, setControlUrl] = useState<string | null>(null);

  const [screen, setScreen] = useState<Screen>("home");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Sesión + URL del control se generan en el cliente (evita hydration mismatch).
  useEffect(() => {
    const id = makeSessionId();
    setSessionId(id);
    setControlUrl(`${window.location.origin}/control?session=${id}`);
  }, []);

  // Refs espejo del estado para que los handlers (canal + teclado físico) lean
  // siempre el valor actual sin re-suscribirse.
  const itemsRef = useRef(items);
  const focusedRef = useRef(focusedIndex);
  const screenRef = useRef(screen);
  const queryRef = useRef(query);
  const loadingMoreRef = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
    focusedRef.current = focusedIndex;
    screenRef.current = screen;
    queryRef.current = query;
  });

  const handleCommandRef = useRef<(cmd: ControlCommandMessage) => void>(() => {});
  const sendStateRef = useRef<((s: import("@/lib/tv-protocol").TvStateMessage) => void) | null>(
    null,
  );

  const { status, paired, sendState } = useTvChannel({
    sessionId: sessionId ?? "",
    role: "tv",
    onCommand: (cmd) => handleCommandRef.current(cmd),
    onPeerJoin: () => {
      sendStateRef.current?.({ type: "PAIRED" });
      emitScreen();
    },
  });
  useEffect(() => {
    sendStateRef.current = sendState;
  }, [sendState]);

  /** Reenvía al teléfono el estado actual de la pantalla de la TV. */
  const emitScreen = useCallback(() => {
    const its = itemsRef.current;
    const focused = its[focusedRef.current]?.id ?? null;
    const scr = screenRef.current;
    sendState({
      type: "SCREEN",
      screen: scr,
      focusedId: focused,
      items: its,
    });
  }, [sendState]);

  const focusById = useCallback(
    (mediaId: string) => {
      const idx = itemsRef.current.findIndex((i) => i.id === mediaId);
      if (idx < 0 || idx === focusedRef.current) return;
      focusedRef.current = idx;
      setFocusedIndex(idx);
      emitScreen();
    },
    [emitScreen],
  );

  const moveFocus = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const len = itemsRef.current.length;
      if (len === 0) return;
      const cur = focusedRef.current;
      let next = cur;
      if (direction === "right") next = Math.min(cur + 1, len - 1);
      else if (direction === "left") next = Math.max(cur - 1, 0);
      else if (direction === "down") next = Math.min(cur + GRID_COLS, len - 1);
      else if (direction === "up") next = Math.max(cur - GRID_COLS, 0);
      if (next !== cur) {
        focusedRef.current = next;
        setFocusedIndex(next);
        emitScreen();
      }
    },
    [emitScreen],
  );

  // Trae pósters (iTunes) de los recs dados y los mezcla por título en los items
  // actuales, reenviando el estado al teléfono cuando llegan.
  const mergePosters = useCallback(
    (recs: Rec[]) => {
      fetchPostersClient(recs.map((r) => ({ title: r.title, type: r.type }))).then((map) => {
        const merged = itemsRef.current.map((it) => {
          const url = map[it.title];
          return !it.posterUrl && url ? { ...it, posterUrl: url } : it;
        });
        itemsRef.current = merged;
        setItems(merged);
        emitScreen();
      });
    },
    [emitScreen],
  );

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQuery(trimmed);
      queryRef.current = trimmed;
      setScreen("search");
      screenRef.current = "search";
      setLoading(true);
      setError(null);
      emitScreen();

      try {
        const ctx = inferContext();
        const data = await recommendFromText({
          data: {
            text: trimmed,
            platforms: PLATFORM_OPTIONS as Platform[],
            contextHint: contextToPromptHint(ctx),
            seasonHint: seasonHintShort(ctx),
          },
        });

        const recs: Rec[] = [data.main, ...data.alternatives];
        const baseItems = recsToItems(recs, 0);
        itemsRef.current = baseItems;
        focusedRef.current = 0;
        setItems(baseItems);
        setFocusedIndex(0);
        setLoading(false);
        emitScreen();
        mergePosters(recs);
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : "No pudimos buscar. Probá de nuevo.");
      }
    },
    [emitScreen, mergePosters],
  );

  // Carga infinita: el teléfono llegó al final → pedimos más, excluyendo lo ya visto.
  const loadMore = useCallback(async () => {
    const its = itemsRef.current;
    if (loadingMoreRef.current || its.length === 0 || its.length >= MAX_ITEMS) return;
    if (!queryRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const ctx = inferContext();
      const data = await recommendFromText({
        data: {
          text: queryRef.current,
          platforms: PLATFORM_OPTIONS as Platform[],
          contextHint: contextToPromptHint(ctx),
          seasonHint: seasonHintShort(ctx),
          excludeTitles: its.map((i) => i.title).slice(0, 40),
        },
      });
      const recs: Rec[] = [data.main, ...data.alternatives];
      const seen = new Set(its.map((i) => i.title.toLowerCase()));
      const freshRecs = recs.filter((r) => !seen.has(r.title.toLowerCase()));
      if (freshRecs.length === 0) return;
      const merged = [...its, ...recsToItems(freshRecs, its.length)];
      itemsRef.current = merged;
      setItems(merged);
      emitScreen();
      mergePosters(freshRecs);
    } catch {
      /* silencioso: el teléfono puede reintentar al seguir scrolleando */
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [emitScreen, mergePosters]);

  const openDetail = useCallback(
    (mediaId?: string) => {
      const its = itemsRef.current;
      const item = mediaId ? its.find((i) => i.id === mediaId) : its[focusedRef.current];
      if (!item) return;
      setSelected(item);
      setScreen("detail");
      screenRef.current = "detail";
      emitScreen();
    },
    [emitScreen],
  );

  const play = useCallback(
    (mediaId?: string) => {
      const its = itemsRef.current;
      const item = mediaId
        ? its.find((i) => i.id === mediaId)
        : (selected ?? its[focusedRef.current]);
      if (!item) return;
      setSelected(item);
      setScreen("player");
      screenRef.current = "player";
      sendState({ type: "NOW_PLAYING", media: item });
      if (item.platform) {
        window.open(deepLinkFor(item.platform, item.title), "_blank", "noopener,noreferrer");
      }
    },
    [selected, sendState],
  );

  const goBack = useCallback(() => {
    const scr = screenRef.current;
    const target: Screen = scr === "player" ? "detail" : scr === "detail" ? "search" : "home";
    setScreen(target);
    screenRef.current = target;
    if (target !== "detail") setSelected(null);
    emitScreen();
  }, [emitScreen]);

  const removeById = useCallback(
    (mediaId: string) => {
      const idx = itemsRef.current.findIndex((i) => i.id === mediaId);
      if (idx < 0) return;
      const next = itemsRef.current.filter((i) => i.id !== mediaId);
      itemsRef.current = next;
      if (focusedRef.current >= next.length) focusedRef.current = Math.max(0, next.length - 1);
      setItems(next);
      setFocusedIndex(focusedRef.current);
      emitScreen();
    },
    [emitScreen],
  );

  const showList = useCallback(
    (listItems: MediaItem[]) => {
      itemsRef.current = listItems;
      focusedRef.current = 0;
      setItems(listItems);
      setFocusedIndex(0);
      setScreen("search");
      screenRef.current = "search";
      setQuery("");
      emitScreen();
    },
    [emitScreen],
  );

  // Un único punto que aplica los comandos, venga del teléfono o de las teclas físicas.
  const handleCommand = useCallback(
    (cmd: ControlCommandMessage) => {
      switch (cmd.type) {
        case "SEARCH":
          void runSearch(cmd.query);
          break;
        case "FOCUS":
          focusById(cmd.mediaId);
          break;
        case "LOAD_MORE":
          void loadMore();
          break;
        case "NAVIGATE":
          moveFocus(cmd.direction);
          break;
        case "SELECT":
          openDetail(cmd.mediaId);
          break;
        case "PLAY":
          play(cmd.mediaId);
          break;
        case "REMOVE":
          removeById(cmd.mediaId);
          break;
        case "SHOW_LIST":
          showList(cmd.items);
          break;
        case "BACK":
          goBack();
          break;
      }
    },
    [runSearch, focusById, loadMore, moveFocus, openDetail, play, goBack, removeById, showList],
  );
  useEffect(() => {
    handleCommandRef.current = handleCommand;
  }, [handleCommand]);

  // Teclas físicas del control / teclado: conviven con los comandos del teléfono.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, ControlCommandMessage | undefined> = {
        ArrowUp: { type: "NAVIGATE", direction: "up" },
        ArrowDown: { type: "NAVIGATE", direction: "down" },
        ArrowLeft: { type: "NAVIGATE", direction: "left" },
        ArrowRight: { type: "NAVIGATE", direction: "right" },
        Enter: { type: "SELECT" },
        Backspace: { type: "BACK" },
        Escape: { type: "BACK" },
      };
      const cmd = map[e.key];
      if (cmd) {
        e.preventDefault();
        handleCommandRef.current(cmd);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="min-h-screen bg-background px-10 py-8 text-foreground">
      {/* Barra superior: marca + estado de vinculación */}
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tv className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold tracking-tight">Cinéfilo TV</span>
        </div>
        <PairBadge paired={paired} connecting={status === "connecting"} />
      </header>

      {!paired ? (
        <PairPanel controlUrl={controlUrl} sessionId={sessionId} />
      ) : (
        <section>
          {query && (
            <div className="mb-5 flex items-center gap-2 text-lg text-muted-foreground">
              <Search className="h-5 w-5" />
              <span>
                Resultados para <span className="text-foreground">“{query}”</span>
              </span>
            </div>
          )}

          {loading ? (
            <div className="flex h-[50vh] items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-xl">Buscando…</span>
            </div>
          ) : error ? (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
              {error}
            </div>
          ) : screen === "home" || items.length === 0 ? (
            <EmptyHome />
          ) : screen === "player" && selected ? (
            <PlayerView media={selected} />
          ) : screen === "detail" && selected ? (
            <DetailView media={selected} />
          ) : (
            <>
              <Spotlight item={items[focusedIndex] ?? null} />
              <ResultsGrid items={items} focusedIndex={focusedIndex} />
              {loadingMore && (
                <div className="mt-6 flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Cargando más…</span>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function PairBadge({ paired, connecting }: { paired: boolean; connecting: boolean }) {
  const label = connecting ? "Conectando…" : paired ? "Teléfono vinculado" : "Esperando teléfono";
  const dot = connecting ? "bg-amber-400" : paired ? "bg-emerald-400" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

function PairPanel({
  controlUrl,
  sessionId,
}: {
  controlUrl: string | null;
  sessionId: string | null;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 text-center">
      <div className="max-w-lg">
        <h1 className="text-4xl font-bold">Usá tu teléfono como control</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Escaneá el código con la cámara y buscá qué ver desde tu teléfono.
        </p>
      </div>
      <div className="rounded-3xl border border-border bg-white p-6 shadow-xl">
        {controlUrl ? (
          <QRCodeSVG value={controlUrl} size={240} level="M" />
        ) : (
          <div className="flex h-[240px] w-[240px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Smartphone className="h-4 w-4" />
        {sessionId ? (
          <span>
            Sesión <span className="font-mono text-foreground">{sessionId}</span>
          </span>
        ) : (
          <span>Generando sesión…</span>
        )}
      </div>
    </div>
  );
}

function EmptyHome() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center text-muted-foreground">
      <Search className="h-12 w-12 text-primary/70" />
      <p className="max-w-md text-xl">
        Escribí en tu teléfono qué tenés ganas de ver y aparecerá acá.
      </p>
    </div>
  );
}

/** Panel fijo con la explicación de la película actualmente enfocada. */
function Spotlight({ item }: { item: MediaItem | null }) {
  if (!item) return null;
  return (
    <div className="sticky top-0 z-10 mb-5 flex gap-5 rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl font-bold text-foreground">{item.title}</h3>
          {item.year && <span className="text-base text-muted-foreground">{item.year}</span>}
        </div>
        {item.platform && (
          <span
            className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-sm font-medium text-white"
            style={{ backgroundColor: colorForPlatform(item.platform) }}
          >
            {item.platform}
          </span>
        )}
        {item.synopsis && <p className="mt-2 text-base text-muted-foreground">{item.synopsis}</p>}
        {item.reason && (
          <p className="mt-2 text-base text-foreground/90">
            <span className="font-semibold text-primary">Por qué: </span>
            {item.reason}
          </p>
        )}
      </div>
    </div>
  );
}

function ResultsGrid({ items, focusedIndex }: { items: MediaItem[]; focusedIndex: number }) {
  const focusedElRef = useRef<HTMLDivElement | null>(null);
  // Cuando cambia el foco (al scrollear en el teléfono), traemos esa tarjeta a la vista.
  useEffect(() => {
    focusedElRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedIndex]);

  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
    >
      {items.map((item, i) => (
        <PosterCard
          key={item.id}
          item={item}
          focused={i === focusedIndex}
          cardRef={i === focusedIndex ? focusedElRef : undefined}
        />
      ))}
    </div>
  );
}

function PosterCard({
  item,
  focused,
  cardRef,
}: {
  item: MediaItem;
  focused: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-2xl border bg-card transition-all duration-150 ${
        focused
          ? "scale-[1.04] border-primary ring-4 ring-primary/50 shadow-2xl"
          : "border-border/60 opacity-80"
      }`}
    >
      <div className="aspect-[2/3] w-full bg-muted">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {item.title}
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-base font-semibold text-foreground">{item.title}</p>
        {item.platform && (
          <p className="mt-0.5 text-sm" style={{ color: colorForPlatform(item.platform) }}>
            {item.platform}
          </p>
        )}
      </div>
    </div>
  );
}

function DetailView({ media }: { media: MediaItem }) {
  return (
    <div className="flex items-center gap-10">
      <div className="aspect-[2/3] w-72 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted">
        {media.posterUrl ? (
          <img src={media.posterUrl} alt={media.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-4 text-center text-muted-foreground">
            {media.title}
          </div>
        )}
      </div>
      <div>
        <h2 className="text-4xl font-bold">{media.title}</h2>
        {media.platform && (
          <p className="mt-2 text-xl" style={{ color: colorForPlatform(media.platform) }}>
            {media.platform}
          </p>
        )}
        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
          <Play className="h-5 w-5" />
          Reproducir (Enter / botón del teléfono)
        </div>
      </div>
    </div>
  );
}

function PlayerView({ media }: { media: MediaItem }) {
  return (
    <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-center">
      <Play className="h-16 w-16 text-primary" />
      <h2 className="text-3xl font-bold">Reproduciendo</h2>
      <p className="text-xl text-muted-foreground">{media.title}</p>
      {media.platform && (
        <p className="text-lg" style={{ color: colorForPlatform(media.platform) }}>
          en {media.platform}
        </p>
      )}
    </div>
  );
}
