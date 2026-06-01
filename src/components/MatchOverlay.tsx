import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { colorForPlatform, deepLinkFor } from "@/lib/recommendations";
import type { SwipeItem } from "./SwipeCardDeck";

type Props = {
  item: SwipeItem;
  posters: Record<string, string | null>;
  onClose: () => void;
  onContinue: () => void;
};

export function MatchOverlay({ item, posters, onClose, onContinue }: Props) {
  const { rec } = item;
  const poster = posters[rec.title] ?? null;
  const color = colorForPlatform(rec.platform as never);

  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center animate-fade-in"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)" }}
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20"
        aria-label="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Converging bubbles */}
      <div
        className="flex items-center justify-center gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Poster */}
        <div
          className="h-28 w-[84px] overflow-hidden rounded-2xl [animation:match-slide-left_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both]"
          style={{ boxShadow: `0 0 40px ${color}55` }}
        >
          {poster ? (
            <img src={poster} alt={rec.title} className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ background: `${color}30` }}
            >
              <span className="text-4xl font-black" style={{ color, opacity: 0.4 }}>
                {rec.title.charAt(0)}
              </span>
            </div>
          )}
        </div>

        {/* Heart */}
        <div className="flex flex-col items-center gap-1 [animation:match-scale-in_0.4s_ease-out_0.25s_both]">
          <span className="text-4xl leading-none">❤️</span>
          <span className="text-2xl leading-none opacity-50">❤️</span>
        </div>

        {/* AI orb */}
        <div
          className="flex h-28 w-[84px] items-center justify-center overflow-hidden rounded-2xl [animation:match-slide-right_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both]"
          style={{
            background: "conic-gradient(from 0deg, #3b82f6, #8b5cf6, #ec4899, #06b6d4, #3b82f6)",
            boxShadow: "0 0 40px rgba(139,92,246,0.55)",
          }}
        >
          <span className="text-4xl">🎬</span>
        </div>
      </div>

      {/* Text */}
      <div
        className="mt-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-5xl font-black text-white [animation:match-scale-in_0.35s_ease-out_0.15s_both]">
          ¡Match!
        </p>
        <p className="mt-2 text-xl font-semibold text-white/90 [animation:match-scale-in_0.35s_ease-out_0.25s_both]">
          {rec.title}
        </p>
        <p className="mt-1.5 text-[13px] text-white/45 [animation:match-scale-in_0.35s_ease-out_0.35s_both]">
          El asistente también elegiría esta para vos.
        </p>
      </div>

      {/* Buttons */}
      <div
        className="mt-8 flex gap-3 [animation:match-scale-in_0.35s_ease-out_0.4s_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={deepLinkFor(rec.platform, rec.title)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: color }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ver en {rec.platform}
        </a>
        <button
          onClick={onContinue}
          className="rounded-full border border-white/20 px-5 py-2.5 text-[13px] font-semibold text-white/80 transition-all hover:bg-white/10"
        >
          Seguir descubriendo
        </button>
      </div>
    </div>
  );
}
