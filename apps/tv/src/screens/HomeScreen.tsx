// Home tipo streaming (referencia: Netflix/Paramount+): chips IA arriba, hero
// destacado, y rails de contenido real. Navegable con D-pad (control físico) y
// con el teléfono (vía el bridge). OK sobre un título abre la ficha de detalle.

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Sparkles, Play, Info, Smartphone } from "lucide-react";
import type { DeckItem } from "../lib/media";
import type { JwResult } from "../lib/justwatch";
import { colorForPlatform, platformLabel } from "../lib/deeplink";
import { inferContext, contextToPromptHint } from "../lib/context";
import { getCountry, cn } from "../lib/tv-utils";
import { useDpad, type DpadRow, type DpadBridge } from "../hooks/useDpad";

// Si en TVs viejas el scroll suave va lento, cambiar a "auto".
const SCROLL_BEHAVIOR: ScrollBehavior = "smooth";

interface HomeScreenProps {
  heroItem: DeckItem | null;
  recs: DeckItem[];
  latest: DeckItem[];
  explore: DeckItem[];
  posters: Record<string, string | null>;
  availability: Record<string, JwResult>;
  paired: boolean;
  onChip: (query: string) => void;
  onOpenDetail: (item: DeckItem) => void;
  onPlayHero: (item: DeckItem) => void;
  onLoadMoreExplore: () => void;
  onFocusedItemChange: (id: string | null) => void;
  onBack: () => void;
  bridgeRef: MutableRefObject<DpadBridge | null>;
}

export function HomeScreen({
  heroItem,
  recs,
  latest,
  explore,
  posters,
  availability,
  paired,
  onChip,
  onOpenDetail,
  onPlayHero,
  onLoadMoreExplore,
  onFocusedItemChange,
  onBack,
  bridgeRef,
}: HomeScreenProps) {
  const chips = useMemo(() => {
    const ctx = inferContext();
    const ctxChip =
      ctx.dayType === "finde"
        ? { label: "Plan de finde", q: `algo ideal para ${contextToPromptHint(ctx)}` }
        : { label: `Para esta ${ctx.dayPart}`, q: `algo ideal para un ${contextToPromptHint(ctx)}` };
    return [
      ctxChip,
      { label: "Algo liviano", q: "algo liviano y entretenido para relajar" },
      { label: "Suspenso", q: "un buen suspenso o thriller que enganche" },
      { label: "En familia", q: "algo para ver en familia, apto para todos" },
      { label: "Un clásico", q: "una película clásica imperdible" },
    ];
  }, []);

  const rows: DpadRow[] = [
    { id: "chips", count: chips.length },
    { id: "hero", count: heroItem ? 2 : 0 },
    { id: "recs", count: recs.length },
    { id: "latest", count: latest.length },
    { id: "explore", count: explore.length },
  ];

  const railById = (rowId: string): DeckItem[] =>
    rowId === "recs" ? recs : rowId === "latest" ? latest : rowId === "explore" ? explore : [];

  const dpad = useDpad({
    rows,
    rememberColumns: true,
    onBack,
    onSelect: (rowId, col) => {
      if (rowId === "chips") {
        onChip(chips[col].q);
      } else if (rowId === "hero") {
        if (!heroItem) return;
        if (col === 0) onPlayHero(heroItem);
        else onOpenDetail(heroItem);
      } else {
        const it = railById(rowId)[col];
        if (it) onOpenDetail(it);
      }
    },
    onFocusChange: (rowId, col) => {
      let id: string | null = null;
      if (rowId === "hero") id = heroItem?.id ?? null;
      else if (rowId !== "chips") id = railById(rowId)[col]?.id ?? null;
      onFocusedItemChange(id);
      if (rowId === "explore" && col >= explore.length - 3) onLoadMoreExplore();
    },
  });

  // Foco por id (comando FOCUS del teléfono) — solo esta pantalla sabe el layout.
  const focusById = useCallback(
    (id: string) => {
      if (heroItem && heroItem.id === id) {
        dpad.setFocus("hero", 0);
        return;
      }
      for (const rowId of ["recs", "latest", "explore"]) {
        const idx = railById(rowId).findIndex((d) => d.id === id);
        if (idx >= 0) {
          dpad.setFocus(rowId, idx);
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dpad.setFocus, heroItem, recs, latest, explore],
  );

  useEffect(() => {
    bridgeRef.current = { move: dpad.move, select: dpad.select, setFocus: dpad.setFocus, focusById };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, dpad.move, dpad.select, dpad.setFocus, focusById]);

  // Scroll del ítem enfocado a la vista (vertical + horizontal).
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    const el = cardRefs.current.get(`${dpad.focusedRowId}:${dpad.focusedCol}`);
    el?.scrollIntoView({ block: "center", inline: "center", behavior: SCROLL_BEHAVIOR });
  }, [dpad.focusedRowId, dpad.focusedCol]);

  const setRef = (key: string) => (el: HTMLElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  const heroPoster = heroItem ? posters[heroItem.title] : undefined;
  const heroAvail = heroItem ? availability[heroItem.title] : undefined;
  const heroColor = heroItem ? colorForPlatform(heroItem.platform) : "#6d28d9";

  return (
    <div className="relative h-screen w-screen overflow-y-auto bg-background">
      {/* Barra superior: marca + chips + estado teléfono */}
      <div className="sticky top-0 z-20 flex items-center gap-4 bg-background/95 px-[4vw] pt-6 pb-3 backdrop-blur">
        <div className="flex shrink-0 items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-foreground">Cinéfilo</span>
        </div>
        <div className="flex flex-1 gap-3 overflow-x-hidden">
          {chips.map((c, i) => (
            <button
              key={c.label}
              ref={setRef(`chips:${i}`)}
              onClick={() => onChip(c.q)}
              className={cn(
                "shrink-0 rounded-full border-2 px-5 py-2 text-base font-semibold transition-all",
                dpad.isFocused("chips", i)
                  ? "tv-focus border-primary bg-primary/15 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {paired && (
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
            <Smartphone className="h-4 w-4 text-green-400" /> Teléfono
          </span>
        )}
      </div>

      {/* Hero destacado */}
      {heroItem && (
        <div className="relative mx-[4vw] mt-2 h-[42vh] overflow-hidden rounded-3xl border border-border bg-muted/20">
          {heroPoster && (
            <img src={heroPoster} alt={heroItem.title} className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />
          <div className="relative flex h-full max-w-2xl flex-col justify-center gap-4 p-10">
            <div className="flex items-center gap-3">
              <span
                className="rounded-full px-3 py-1 text-sm font-bold text-white"
                style={{ backgroundColor: heroColor }}
              >
                {platformLabel(heroItem.platform)}
              </span>
              <span className="text-base text-muted-foreground">
                {[heroItem.type, heroItem.year].filter(Boolean).join(" · ")}
              </span>
            </div>
            <h1 className="text-5xl font-bold leading-tight text-foreground">{heroItem.title}</h1>
            {heroItem.synopsis && (
              <p className="max-w-xl text-xl leading-relaxed text-foreground/80 line-clamp-2">
                {heroItem.synopsis}
              </p>
            )}
            <div className="mt-1 text-base">
              {heroAvail === undefined ? (
                <span className="text-muted-foreground/50">Verificando disponibilidad...</span>
              ) : heroAvail.confirmed ? (
                <span className="font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
              ) : (
                <span className="text-muted-foreground/50">Verificalo al abrir la app</span>
              )}
            </div>
            <div className="mt-2 flex gap-3">
              <button
                ref={setRef("hero:0")}
                onClick={() => onPlayHero(heroItem)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-8 py-3 text-lg font-bold text-white transition-transform",
                  dpad.isFocused("hero", 0) && "tv-focus",
                )}
                style={{ backgroundColor: heroColor }}
              >
                <Play className="h-5 w-5" /> Ver ahora
              </button>
              <button
                ref={setRef("hero:1")}
                onClick={() => onOpenDetail(heroItem)}
                className={cn(
                  "flex items-center gap-2 rounded-full border-2 border-border bg-background/60 px-8 py-3 text-lg font-semibold text-foreground transition-transform",
                  dpad.isFocused("hero", 1) && "tv-focus",
                )}
              >
                <Info className="h-5 w-5" /> Más info
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rails */}
      <div className="mt-8 flex flex-col gap-8 pb-[6vh]">
        <Rail rowId="recs" title="Recomendadas para vos" items={recs} posters={posters} dpad={dpad} setRef={setRef} />
        <Rail rowId="latest" title="Últimas subidas a las plataformas" items={latest} posters={posters} dpad={dpad} setRef={setRef} />
        {explore.length > 0 && (
          <Rail rowId="explore" title="Más para explorar" items={explore} posters={posters} dpad={dpad} setRef={setRef} />
        )}
      </div>
    </div>
  );
}

function Rail({
  rowId,
  title,
  items,
  posters,
  dpad,
  setRef,
}: {
  rowId: string;
  title: string;
  items: DeckItem[];
  posters: Record<string, string | null>;
  dpad: ReturnType<typeof useDpad>;
  setRef: (key: string) => (el: HTMLElement | null) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="px-[4vw]">
        <h2 className="mb-3 text-2xl font-bold text-foreground">{title}</h2>
        <div className="flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 w-40 shrink-0 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-3 px-[4vw] text-2xl font-bold text-foreground">{title}</h2>
      <div className="flex gap-4 overflow-x-hidden px-[4vw]">
        {items.map((item, i) => {
          const poster = posters[item.title];
          const focused = dpad.isFocused(rowId, i);
          const color = colorForPlatform(item.platform);
          return (
            <button
              key={item.id}
              ref={setRef(`${rowId}:${i}`)}
              onClick={() => dpad.setFocus(rowId, i)}
              className={cn(
                "relative h-56 w-40 shrink-0 overflow-hidden rounded-xl border-2 transition-all",
                focused ? "tv-focus border-primary" : "border-transparent opacity-80",
              )}
            >
              {poster ? (
                <img src={poster} alt={item.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">
                  {item.title}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-6 text-left">
                <p className="truncate text-xs font-semibold text-white">{item.title}</p>
                <span
                  className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {platformLabel(item.platform)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
