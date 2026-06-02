import { useEffect } from "react";
import { colorForPlatform } from "@/lib/recommendations";
import type { SocialMatchRow } from "@/lib/social.functions";

const AUTO_DISMISS_MS = 6000;

type Props = {
  match: SocialMatchRow;
  poster: string | null;
  onClose: () => void;
};

export function SocialMatchOverlay({ match, poster, onClose }: Props) {
  const color = colorForPlatform(match.platform as never);
  const initial = match.other_display_name.charAt(0).toUpperCase();
  const whatsappText = encodeURIComponent(
    `¡Hacemos match en "${match.title}"! ¿La vemos juntos? 🎬`,
  );
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

  useEffect(() => {
    const t = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl bg-white/10 p-8 text-center"
        onClick={(e) => e.stopPropagation()}
        style={{ ["-webkit-backdrop-filter" as string]: "blur(16px)", backdropFilter: "blur(16px)" }}
      >
        {/* Converging avatars */}
        <div className="flex items-center gap-4">
          {/* Movie poster / color block */}
          <div
            className="h-20 w-14 overflow-hidden rounded-xl shadow-lg [animation:match-slide-left_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both]"
            style={!poster ? { background: `${color}cc` } : undefined}
          >
            {poster ? (
              <img src={poster} alt={match.title} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl font-black text-white/50">
                {match.title.charAt(0)}
              </span>
            )}
          </div>

          {/* Hearts */}
          <div className="flex flex-col items-center gap-0.5 [animation:match-scale-in_0.4s_0.3s_cubic-bezier(0.34,1.56,0.64,1)_both]">
            <span className="text-3xl">❤️</span>
          </div>

          {/* Other person avatar */}
          <div
            className="flex h-20 w-14 items-center justify-center rounded-xl text-2xl font-black text-white shadow-lg [animation:match-slide-right_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both]"
            style={{ background: match.other_avatar_color }}
          >
            {initial}
          </div>
        </div>

        {/* Text */}
        <div>
          <p className="text-4xl font-black text-white tracking-tight">¡Match!</p>
          <p className="mt-1 text-[15px] font-semibold text-white/90">{match.other_display_name} y vos eligieron</p>
          <p className="mt-0.5 text-[13px] font-bold text-white/70 italic">"{match.title}"</p>
          <p className="mt-2 text-[12px] text-white/50">¿La ven juntos?</p>
        </div>

        {/* CTAs */}
        <div className="flex w-full flex-col gap-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-2xl py-3 text-[14px] font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: "#25D366" }}
          >
            Escribirle por WhatsApp
          </a>
          <button
            onClick={onClose}
            className="w-full rounded-2xl bg-white/10 py-3 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/20"
          >
            Seguir descubriendo
          </button>
        </div>
      </div>
    </div>
  );
}
