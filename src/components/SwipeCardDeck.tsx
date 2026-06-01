import { useRef, useState } from "react";
import { Bookmark, Heart, X, List } from "lucide-react";
import { colorForPlatform, deepLinkFor } from "@/lib/recommendations";
import type { Recommendation } from "@/lib/recommendations";
import { MatchOverlay } from "./MatchOverlay";
import { ExternalLink } from "lucide-react";

export type SwipeItem = {
  rec: Recommendation;
  isMain: boolean;
};

type Props = {
  items: SwipeItem[];
  posters: Record<string, string | null>;
  onSwipe: (item: SwipeItem, direction: "like" | "skip") => void;
  onWatchlist: (item: SwipeItem) => void;
  onViewAsList: () => void;
};

const SWIPE_THRESHOLD = 80;

export function SwipeCardDeck({ items, posters, onSwipe, onWatchlist, onViewAsList }: Props) {
  const [stack, setStack] = useState<SwipeItem[]>(items);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [swipingOut, setSwipingOut] = useState<"left" | "right" | null>(null);
  const [likedItems, setLikedItems] = useState<SwipeItem[]>([]);
  const [matchItem, setMatchItem] = useState<SwipeItem | null>(null);
  const startXRef = useRef(0);

  const topCard = stack[0] ?? null;

  const completeSwipe = (direction: "like" | "skip") => {
    if (!topCard || swipingOut) return;
    setSwipingOut(direction === "like" ? "right" : "left");
    setIsDragging(false);
    if (direction === "like") {
      setLikedItems((prev) => [...prev, topCard]);
      if (topCard.isMain) {
        setTimeout(() => setMatchItem(topCard), 400);
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

  if (stack.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        {likedItems.length > 0 ? (
          <>
            <p className="text-[13px] font-semibold text-foreground">
              Te gustaron {likedItems.length} {likedItems.length === 1 ? "título" : "títulos"}:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {likedItems.map((item) => (
                <span
                  key={item.rec.title}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-white"
                  style={{ background: colorForPlatform(item.rec.platform as never) }}
                >
                  ❤️ {item.rec.title}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Pasaste todos — ¿buscamos algo diferente?
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground/40">
          Hablá para buscar algo diferente
        </p>
      </div>
    );
  }

  const rotation = dragX * 0.06;
  const directionOpacity = Math.min(Math.abs(dragX) / 120, 1);
  const showLike = dragX > 20;
  const showSkip = dragX < -20;

  let topStyle: React.CSSProperties;
  if (swipingOut === "right") {
    topStyle = { transform: "translateX(130%) rotate(25deg)", transition: "transform 0.35s ease", zIndex: 10 };
  } else if (swipingOut === "left") {
    topStyle = { transform: "translateX(-130%) rotate(-25deg)", transition: "transform 0.35s ease", zIndex: 10 };
  } else {
    topStyle = {
      transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
      transition: isDragging ? "none" : "transform 0.3s ease",
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

        {/* Card stack container */}
        <div className="relative h-[460px] w-full select-none">
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
              onTransitionEnd={() => { if (swipingOut) popStack(); }}
            >
              {/* Direction badges */}
              {showLike && (
                <div
                  className="absolute left-4 top-6 z-20"
                  style={{ opacity: directionOpacity, transform: "rotate(-20deg)" }}
                >
                  <span className="rounded-lg border-2 border-green-500 px-3 py-1 text-[16px] font-black uppercase text-green-500">
                    ME INTERESA
                  </span>
                </div>
              )}
              {showSkip && (
                <div
                  className="absolute right-4 top-6 z-20"
                  style={{ opacity: directionOpacity, transform: "rotate(20deg)" }}
                >
                  <span className="rounded-lg border-2 border-red-400 px-3 py-1 text-[16px] font-black uppercase text-red-400">
                    SIGUIENTE
                  </span>
                </div>
              )}
              <SwipeCard item={topCard} poster={posters[topCard.rec.title] ?? null} />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex items-center justify-center gap-6">
          <button
            onClick={() => completeSwipe("skip")}
            disabled={!!swipingOut}
            aria-label="Pasar"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-200 bg-white text-red-400 shadow-card transition-all hover:border-red-400 hover:bg-red-50 disabled:opacity-40"
          >
            <X className="h-6 w-6" />
          </button>
          <button
            onClick={() => topCard && onWatchlist(topCard)}
            disabled={!!swipingOut || !topCard}
            aria-label="Guardar para después"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-200 bg-white text-amber-400 shadow-card transition-all hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40"
          >
            <Bookmark className="h-4 w-4" />
          </button>
          <button
            onClick={() => completeSwipe("like")}
            disabled={!!swipingOut}
            aria-label="Me interesa"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-green-200 bg-white text-green-500 shadow-card transition-all hover:border-green-400 hover:bg-green-50 disabled:opacity-40"
          >
            <Heart className="h-6 w-6" />
          </button>
        </div>
      </div>
    </>
  );
}

function SwipeCard({ item, poster }: { item: SwipeItem; poster: string | null }) {
  const { rec } = item;
  const color = colorForPlatform(rec.platform as never);

  return (
    <div className="h-full w-full overflow-hidden rounded-2xl bg-white shadow-float">
      {/* Poster — top 55% */}
      <div className="relative" style={{ height: "55%" }}>
        {poster ? (
          <img src={poster} alt={rec.title} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `${color}18` }}
          >
            <span className="text-7xl font-black" style={{ color, opacity: 0.15 }}>
              {rec.title.charAt(0)}
            </span>
          </div>
        )}
        {/* Bottom gradient overlay */}
        <div
          className="absolute bottom-0 left-0 right-0 h-20"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)" }}
        />
      </div>

      {/* Content — bottom 45% */}
      <div className="flex flex-col gap-2 p-4" style={{ height: "45%" }}>
        <div
          className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5"
          style={{ background: `${color}14` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          <span className="text-[10px] font-semibold" style={{ color }}>
            {rec.platform}
          </span>
        </div>

        <h3 className="text-[18px] font-bold leading-tight tracking-tight text-foreground">
          {rec.title}
        </h3>

        <p className="text-[11px] text-muted-foreground/70">
          {rec.duration} · {rec.type}
        </p>

        <p className="line-clamp-3 text-[12px] leading-relaxed text-foreground/60">
          {rec.reason}
        </p>

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
