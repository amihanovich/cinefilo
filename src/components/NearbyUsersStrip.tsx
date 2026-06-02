import { useEffect, useState } from "react";
import { getNearbyUsers } from "@/lib/social.functions";
import type { NearbyUser, MoodFilters } from "@/lib/social.functions";
import { cn } from "@/lib/utils";

const MOOD_EMOJI: Record<string, string> = {
  "Algo liviano": "😌",
  "Comedia": "😄",
  "Drama": "🎭",
  "Suspenso": "😱",
  "Acción": "⚡",
  "Documental": "🎓",
  "Épico para relajar": "🛋️",
};

const COMPANY_EMOJI: Record<string, string> = {
  "Solo": "🎧",
  "En pareja": "💑",
  "Familia con niños": "👨‍👩‍👧",
  "Con amigos": "👥",
};

function moodMatches(user: NearbyUser, active: MoodFilters | null): boolean {
  if (!active) return false;
  return (
    (!!active.company && user.company_filter === active.company) ||
    (!!active.mood && user.mood_filter === active.mood)
  );
}

type Props = {
  location: { lat: number; lng: number };
  activeMoodFilters: MoodFilters | null;
};

export function NearbyUsersStrip({ location, activeMoodFilters }: Props) {
  const [users, setUsers] = useState<NearbyUser[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    getNearbyUsers({ data: { lat: location.lat, lng: location.lng } })
      .then((result) => { setUsers(result); setLoaded(true); })
      .catch(() => setLoaded(true));

    const interval = setInterval(() => {
      getNearbyUsers({ data: { lat: location.lat, lng: location.lng } })
        .then(setUsers)
        .catch(() => {});
    }, 30_000);

    return () => clearInterval(interval);
  }, [location.lat, location.lng]);

  if (!loaded || users.length === 0) {
    return loaded ? (
      <p className="mt-3 text-center text-[11px] text-muted-foreground/40 animate-fade-in">
        Nadie cerca con Modo Social activo todavía
      </p>
    ) : null;
  }

  return (
    <div className="mt-3 w-full animate-fade-in">
      <p className="mb-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground/40">
        {users.length} {users.length === 1 ? "persona cerca" : "personas cerca"}
      </p>
      <div className="flex gap-3 overflow-x-auto px-1 pb-1 scrollbar-none">
        {users.map((u) => {
          const isMatch = moodMatches(u, activeMoodFilters);
          const initial = u.display_name.charAt(0).toUpperCase();
          const moodEmoji = u.mood_filter ? (MOOD_EMOJI[u.mood_filter] ?? "🎬") : null;
          const companyEmoji = u.company_filter ? (COMPANY_EMOJI[u.company_filter] ?? null) : null;
          const contextEmoji = companyEmoji ?? moodEmoji ?? "🎬";

          return (
            <div
              key={u.user_id}
              className="flex shrink-0 flex-col items-center gap-1.5 [animation:slide-up-fade_0.4s_cubic-bezier(0.34,1.56,0.64,1)_both]"
            >
              <div
                className={cn(
                  "relative flex h-12 w-12 items-center justify-center rounded-full text-[18px] font-black text-white shadow-sm transition-transform",
                  isMatch && "ring-2 ring-offset-2 ring-primary/60 scale-110 [animation:pulse_2s_ease-in-out_infinite]",
                )}
                style={{ background: u.avatar_color }}
              >
                {initial}
                {isMatch && (
                  <span className="absolute -top-1 -right-1 text-[10px]">💜</span>
                )}
              </div>
              <span className="max-w-[52px] truncate text-center text-[11px] font-medium text-foreground/80">
                {u.display_name}
              </span>
              <span className="text-[11px]">{contextEmoji}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
