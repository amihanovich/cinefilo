import { useRef, useState } from "react";
import { Heart, X, List, ExternalLink } from "lucide-react";
import { colorForPlatform, deepLinkFor } from "@/lib/recommendations";
import type { Recommendation } from "@/lib/recommendations";
import { MatchOverlay } from "./MatchOverlay";

export type SwipeItem = {
  rec: Recommendation;
  isMain: boolean;
};

type Props = {
  items: SwipeItem[];
  posters: Record<string, string | null>;
  onSwipe: (item: SwipeItem, direction: "like" | "skip") => void;
  onViewAsList: () => void;
};

const SWIPE_THRESHOLD = 80;

export function SwipeCardDeck({ items, posters, onSwipe, onViewAsList }: Props) {
  const [stack, setStack] = useState<SwipeItem[]>(items);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [swipingOut, setSwipingOut] = useState<"left" | "right" | null>(null);
  const [likedItems, setLikedItems] = useState<SwipeItem[]>([]);
  const [matchItem, setMatchItem] = useState<SwipeItem | null>(null);
  const [pileBump, setPileBump] = useState(false);
  const startXRef = useRef(0);

  const topCard = stack[0] ?? null;

  const completeSwipe = (direction: "like" | "skip") => {
    if (!topCard || swipingOut) return;
    setSwipingOut(direction === "like" ? "right" : "left");
    setIsDragging(false);
    if (direction === "like") {
      setLikedItems((prev) => [...prev, topCard]);
      setPileBump(true);
      setTimeout(() => setPileBump(false), 400);
      if (topCard.isMain) {
        setTimeout(() => setMatchItem(topCard), 450);
      }
    }
    onSwipe(topCard, direction);
  };

  const popStack = () => {
    setStack((prev) => prev.slice(1));
    setSwipingOut(null);
    setDragX(0);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (swipingOut) return;
    startXRef.current = e.clientX;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setDragX(e.clientX - startXRef.current);
  };
  const onPointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (Math.abs(dragX) > SWIPE_THRESHOLD) {
      completeSwipe(dragX > 0 ? "like" : "skip");
    } else {
      setDragX(0);
    }
  };

  /* ── End state: Tu selección ───────────────────────────────────────────── */
  if (stack.length === 0) {
    if (likedItems.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 py-8 text-center animate-fade-in">
          <p className="text-2xl">🎬</p>
          <p className="text-[14px] font-semibold text-foreground">Pasaste todos</p>
          <p className="text-[12px] text-muted-foreground/60">Hablá o escribí para buscar algo diferente</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4 py-2 animate-fade-in">
        <div className="text-center">
          <p className="text-[17px] font-bold tracking-tight text-foreground">Tu selección</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground/55">
            {likedItems.length} {likedItems.length === 1 ? "título guardado" : "títulos guardados"} · elegí uno para ver
          </p>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none px-0.5">
          {likedItems.map((item, i) => (
            <SelectedCard
              key={item.rec.title}
              item={item}
              poster={posters[item.rec.title] ?? null}
              delay={i * 60}
            />
          ))}
        </div>
        <p className="text-center text-[11px] text-muted-foreground/35">
          Hablá para buscar algo diferente
        </p>
      </div>
    );
  }

  /* ── Swiping state ─────────────────────────────────────────────────────── */
  const rotation = dragX * 0.06;
  const directionOpacity = Math.min(Math.abs(dragX) / 120, 1);
  const showLike = dragX > 20;
  const showSkip = dragX < -20;

  let topStyle: React.CSSProperties;
  if (swipingOut === "right") {
    // Flies up-right toward the pile corner
    topStyle = {
      transform: "translateX(105%) translateY(-12%) rotate(18deg) scale(0.88)",
      transition: "transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      zIndex: 10,
    };
  } else if (swipingOut === "left") {
    // Fades and shrinks away to the left
    topStyle = {
      opacity: 0,
      transform: "translateX(-18%) scale(0.80)",
      transition: "opacity 0.26s ease, transform 0.26s ease",
      zIndex: 10,
    };
  } else {
    topStyle = {
      transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
      transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
      zIndex: 10,
      cursor: isDragging ? "grabbing" : "grab",
    };
  }

  return (
    <>
      {matchItem && (
        <MatchOverlay
          item={matchItem}
          posters={posters}
          onClose={() => setMatchItem(null)}
          onContinue={() => setMatchItem(null)}
        />
      )}

      <div className="relative">
        {/* Header row */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/50">
            {stack.length} {stack.length === 1 ? "título" : "títulos"} restantes
          </span>
          <button
            onClick={onViewAsList}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <List className="h-3.5 w-3.5" />
            Ver como lista
          </button>
        </div>

        {/* Card stack + pile side-by-side */}
        <div className="flex items-start gap-3">
          {/* Main deck */}
          <div className="relative h-[460px] min-w-0 flex-1 select-none">
            {/* Background cards */}
            {stack.slice(1, 3).map((item, idx) => (
              <div
                key={item.rec.title}
                className="absolute inset-0"
                style={{
                  zIndex: 9 - idx,
                  transform: `scale(${1 - 0.04 * (idx + 1)}) translateY(${8 * (idx + 1)}px)`,
                  transition: "transform 0.3s ease",
                  pointerEvents: "none",
                }}
              >
                <SwipeCard item={item} poster={posters[item.rec.title] ?? null} />
              </div>
            ))}

            {/* Top card */}
            {topCard && (
              <div
                className="absolute inset-0"
                style={topStyle}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onTransitionEnd={(e) => {
                  if (!swipingOut) return;
                  if (swipingOut === "left" && e.propertyName === "opacity") popStack();
                  if (swipingOut === "right" && e.propertyName === "transform") popStack();
                }}
              >
                {showLike && (
                  <div
                    className="absolute left-4 top-6 z-20"
                    style={{ opacity: directionOpacity, transform: "rotate(-20deg)" }}
                  >
                    <span className="rounded-lg border-2 border-green-500 px-3 py-1 text-[15px] font-black uppercase text-green-500">
                      ME GUSTA
                    </span>
                  </div>
                )}
                {showSkip && (
                  <div
                    className="absolute right-4 top-6 z-20"
                    style={{ opacity: directionOpacity, transform: "rotate(20deg)" }}
                  >
                    <span className="rounded-lg border-2 border-red-400 px-3 py-1 text-[15px] font-black uppercase text-red-400">
                      PASO
                    </span>
                  </div>
                )}
                <SwipeCard item={topCard} poster={posters[topCard.rec.title] ?? null} />
              </div>
            )}
          </div>

          {/* Liked pile — visible side stack */}
          <div
            className="flex shrink-0 flex-col items-center gap-2 pt-2 transition-all duration-300"
            style={{ width: 64, minHeight: 80, opacity: likedItems.length > 0 ? 1 : 0.18 }}
          >
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              {likedItems.length > 0 ? "Guardadas" : "···"}
            </p>
            <div
              className="relative"
              style={{
                width: 52,
                height: 72,
                transform: pileBump ? "scale(1.12)" : "scale(1)",
                transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
              }}
            >
              {likedItems.length === 0 ? (
                <div className="absolute inset-0 rounded-xl border-2 border-dashed border-muted-foreground/20" />
              ) : (
                likedItems.slice(-4).map((item, i, arr) => {
                  const poster = posters[item.rec.title];
                  const color = colorForPlatform(item.rec.platform as never);
                  return (
                    <div
                      key={`pile-${item.rec.title}`}
                      className="absolute inset-0 overflow-hidden rounded-xl shadow-sm"
                      style={{
                        transform: `rotate(${(i - (arr.length - 1) / 2) * 8}deg)`,
                        zIndex: i,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
                      }}
                    >
                      {poster ? (
                        <img src={poster} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full" style={{ background: color }} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {likedItems.length > 0 && (
              <span className="rounded-full bg-pink-500 px-2 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                ♥ {likedItems.length}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex items-center justify-center gap-8">
          <button
            onClick={() => completeSwipe("skip")}
            disabled={!!swipingOut}
            aria-label="Pasar"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-200 bg-white text-red-400 shadow-card transition-all hover:border-red-400 hover:bg-red-50 disabled:opacity-40"
          >
            <X className="h-6 w-6" />
          </button>
          <button
            onClick={() => completeSwipe("like")}
            disabled={!!swipingOut}
            aria-label="Me gusta"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-green-200 bg-white text-green-500 shadow-card transition-all hover:border-green-400 hover:bg-green-50 disabled:opacity-40"
          >
            <Heart className="h-6 w-6" />
          </button>
        </div>
      </div>
    </>
  );
}

/* ── SelectedCard — end state ──────────────────────────────────────────────── */
function SelectedCard({ item, poster, delay }: { item: SwipeItem; poster: string | null; delay: number }) {
  const { rec } = item;
  const color = colorForPlatform(rec.platform as never);
  return (
    <div
      className="shrink-0 w-[145px] overflow-hidden rounded-2xl bg-white shadow-card"
      style={{ animation: `slide-up-fade 0.4s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms both` }}
    >
      <div className="relative h-[196px]">
        {poster ? (
          <img src={poster} alt={rec.title} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center" style={{ background: `${color}18` }}>
            <span className="text-5xl font-black" style={{ color, opacity: 0.18 }}>{rec.title[0]}</span>
          </div>
        )}
        {item.isMain && (
          <div className="absolute top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-white shadow-primary">
            ⭐ Top pick
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="line-clamp-2 text-[12px] font-bold leading-tight text-foreground">{rec.title}</p>
        <a
          href={deepLinkFor(rec.platform, rec.title)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center gap-1 rounded-full py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: color }}
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Ver en {rec.platform}
        </a>
      </div>
    </div>
  );
}

/* ── SwipeCard ─────────────────────────────────────────────────────────────── */
function SwipeCard({ item, poster }: { item: SwipeItem; poster: string | null }) {
  const { rec } = item;
  const color = colorForPlatform(rec.platform as never);

  return (
    <div className="h-full w-full overflow-hidden rounded-2xl bg-white shadow-float">
      <div className="relative" style={{ height: "55%" }}>
        {poster ? (
          <img src={poster} alt={rec.title} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ background: `${color}18` }}>
            <span className="text-7xl font-black" style={{ color, opacity: 0.15 }}>{rec.title.charAt(0)}</span>
          </div>
        )}
        <div
          className="absolute bottom-0 left-0 right-0 h-20"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)" }}
        />
      </div>
      <div className="flex flex-col gap-2 p-4" style={{ height: "45%" }}>
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5" style={{ background: `${color}14` }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          <span className="text-[10px] font-semibold" style={{ color }}>{rec.platform}</span>
        </div>
        <h3 className="text-[18px] font-bold leading-tight tracking-tight text-foreground">{rec.title}</h3>
        <p className="text-[11px] text-muted-foreground/70">{rec.duration} · {rec.type}</p>
        <p className="line-clamp-3 text-[12px] leading-relaxed text-foreground/60">{rec.reason}</p>
        <a
          href={deepLinkFor(rec.platform, rec.title)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-auto inline-flex w-fit items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: color }}
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Ver en {rec.platform}
        </a>
      </div>
    </div>
  );
}
