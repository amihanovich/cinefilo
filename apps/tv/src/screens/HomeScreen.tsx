// Home tipo streaming: chips IA arriba, un CARRUSEL de banners grandes (los 5
// recomendados principales, uno a la vez tipo pager) y debajo una fila con el
// resto de alternativas. "Más opciones" (desde el teléfono) trae más y las
// agrega a esa fila. Navegable con D-pad (control físico) y con el teléfono.
//
// Filas del D-pad:
//   chips        → sugerencias IA
//   carousel     → ←/→ cambia el banner activo (de los 5); OK = Ver ahora
//   hero-actions → [Ver ahora, Más info] del banner activo
//   alts         → fila de posters con las alternativas

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
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
  carousel: DeckItem[]; // primeros 5 → banners grandes (pager)
  alternatives: DeckItem[]; // el resto → fila de posters
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
  carousel,
  alternatives,
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

  // Banner activo del carrusel. Se actualiza al navegar ←/→ sobre la fila
  // "carousel". activeRef espeja el valor para leerlo dentro de handlers estables.
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  const setActive = useCallback((i: number) => {
    activeRef.current = i;
    setActiveIndex(i);
  }, []);

  // Si el carrusel cambia de tamaño, mantener el índice dentro de rango.
  useEffect(() => {
    const max = Math.max(0, carousel.length - 1);
    if (activeIndex > max) setActive(max);
  }, [carousel.length, activeIndex, setActive]);

  const rows: DpadRow[] = [
    { id: "chips", count: chips.length },
    { id: "carousel", count: carousel.length },
    { id: "hero-actions", count: carousel.length ? 2 : 0 },
    { id: "alts", count: alternatives.length },
  ];

  const dpad = useDpad({
    rows,
    rememberColumns: true,
    onBack,
    onSelect: (rowId, col) => {
      if (rowId === "chips") {
        onChip(chips[col].q);
      } else if (rowId === "carousel") {
        const it = carousel[col];
        if (it) onPlayHero(it); // OK sobre el banner = Ver ahora
      } else if (rowId === "hero-actions") {
        const it = carousel[activeRef.current];
        if (!it) return;
        if (col === 0) onPlayHero(it);
        else onOpenDetail(it);
      } else if (rowId === "alts") {
        const it = alternatives[col];
        if (it) onOpenDetail(it);
      }
    },
    onFocusChange: (rowId, col) => {
      if (rowId === "carousel") {
        setActive(col);
        onFocusedItemChange(carousel[col]?.id ?? null);
      } else if (rowId === "hero-actions") {
        onFocusedItemChange(carousel[activeRef.current]?.id ?? null);
      } else if (rowId === "alts") {
        onFocusedItemChange(alternatives[col]?.id ?? null);
        if (col >= alternatives.length - 3) onLoadMoreExplore();
      } else {
        onFocusedItemChange(null);
      }
    },
  });

  // Foco por id (comando FOCUS del teléfono) — mapea al banner o a la alternativa.
  const focusById = useCallback(
    (id: string) => {
      const ci = carousel.findIndex((d) => d.id === id);
      if (ci >= 0) {
        dpad.setFocus("carousel", ci);
        return;
      }
      const ai = alternatives.findIndex((d) => d.id === id);
      if (ai >= 0) dpad.setFocus("alts", ai);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dpad.setFocus, carousel, alternatives],
  );

  useEffect(() => {
    bridgeRef.current = { move: dpad.move, select: dpad.select, setFocus: dpad.setFocus, focusById };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, dpad.move, dpad.select, dpad.setFocus, focusById]);

  // Scroll del ítem enfocado a la vista.
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    const el = cardRefs.current.get(`${dpad.focusedRowId}:${dpad.focusedCol}`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: SCROLL_BEHAVIOR });
  }, [dpad.focusedRowId, dpad.focusedCol]);

  const setRef = (key: string) => (el: HTMLElement | null) => {
    if (el) cardRefs.current.set(key, el);
    else cardRefs.current.delete(key);
  };

  const active = carousel[activeIndex] ?? carousel[0] ?? null;
  const activePoster = active ? posters[active.title] : undefined;
  const activeAvail = active ? availability[active.title] : undefined;
  const activeColor = active ? colorForPlatform(active.platform) : "#6d28d9";
  const carouselFocused = dpad.focusedRowId === "carousel";

  return (
    <div className="relative h-screen w-screen overflow-y-auto scroll-pt-24 bg-background">
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

      {/* Carrusel de banners (pager): un recomendado grande a la vez, ←/→ cambia. */}
      {active && (
        <div
          ref={setRef(`carousel:${activeIndex}`)}
          className={cn(
            "relative mx-[4vw] mt-2 h-[48vh] scroll-mt-24 overflow-hidden rounded-3xl border bg-muted/20 transition-all",
            carouselFocused ? "tv-focus border-primary" : "border-border",
          )}
        >
          {activePoster && (
            <img src={activePoster} alt={active.title} className="absolute inset-0 h-full w-full object-cover" />
          )}
          {/* Doble gradiente: lateral (cinematográfico) + base, para que el texto
              y la razón se lean SOBRE la imagen sin oscurecer el banner entero. */}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/25 to-transparent" />

          <div className="relative flex h-full max-w-2xl flex-col justify-center gap-3 p-9">
            {/* Dots + posición (1 de 5) */}
            {carousel.length > 1 && (
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1.5">
                  {carousel.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        i === activeIndex ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40",
                      )}
                    />
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">
                  {activeIndex + 1} de {carousel.length}
                </span>
              </div>
            )}

            <h1 className="text-4xl font-bold leading-tight text-foreground">{active.title}</h1>

            {/* Metadata: plataforma, tipo, duración, año, clasificación, disponibilidad. */}
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="rounded-full px-3 py-1 text-sm font-bold text-white"
                style={{ backgroundColor: activeColor }}
              >
                {platformLabel(active.platform)}
              </span>
              <span className="text-base text-muted-foreground">
                {[active.type, active.duration, active.year].filter(Boolean).join(" · ")}
              </span>
              {active.ageRating && (
                <span className="rounded border border-muted-foreground/30 px-2 py-0.5 text-sm font-semibold text-muted-foreground">
                  {active.ageRating}
                </span>
              )}
              {activeAvail === undefined ? (
                <span className="text-sm text-muted-foreground/50">Verificando disponibilidad...</span>
              ) : activeAvail.confirmed ? (
                <span className="text-sm font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
              ) : (
                <span className="text-sm text-muted-foreground/50">Verificalo al abrir la app</span>
              )}
            </div>

            {/* La razón de Cinéfilo — SOBRE la imagen del banner, con realce para
                que se lea. Va directo la descripción (sin etiqueta). shrink-0 evita
                que flex la comprima; line-clamp-3 es tope de seguridad. */}
            {active.reason && (
              <p className="max-w-xl shrink-0 rounded-xl bg-black/45 px-4 py-2.5 text-base leading-relaxed text-foreground/95 backdrop-blur-sm line-clamp-3">
                <span className="mr-1.5 font-semibold text-primary">✦</span>
                {active.reason}
              </p>
            )}

            <div className="mt-1 flex gap-3">
              <button
                ref={setRef("hero-actions:0")}
                onClick={() => onPlayHero(active)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white transition-transform",
                  dpad.isFocused("hero-actions", 0) && "tv-focus",
                )}
                style={{ backgroundColor: activeColor }}
              >
                <Play className="h-4 w-4" /> Ver ahora
              </button>
              <button
                ref={setRef("hero-actions:1")}
                onClick={() => onOpenDetail(active)}
                className={cn(
                  "flex items-center gap-2 rounded-full border-2 border-border bg-background/60 px-5 py-2 text-sm font-semibold text-foreground transition-transform",
                  dpad.isFocused("hero-actions", 1) && "tv-focus",
                )}
              >
                <Info className="h-4 w-4" /> Más info
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fila de alternativas (el resto de recomendaciones). "Más opciones" desde
          el teléfono agrega más acá. */}
      <div className="mt-8 flex flex-col gap-8 pb-[6vh]">
        <Rail
          rowId="alts"
          title="Más opciones para vos"
          items={alternatives}
          posters={posters}
          dpad={dpad}
          setRef={setRef}
        />
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
