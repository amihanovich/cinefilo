import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Tv } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recommendConversational } from "@/lib/recommendations.functions";
import { deepLinkFor } from "@/lib/recommendations";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import { fetchPostersClient } from "@/lib/itunes";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/recommendations";

export const Route = createFileRoute("/wizard")({
  component: WizardPage,
});

const SESSION_ID = "cinefilo-test";

const PLATFORMS = [
  "Netflix", "Disney+", "Max", "Prime Video",
  "Apple TV+", "Paramount+", "Star+",
];

const MOODS = [
  { label: "Reírme", emoji: "😂", value: "Comedia", query: "una comedia para reírme" },
  { label: "Sorprenderme", emoji: "😮", value: "Acción", query: "algo que me sorprenda" },
  { label: "Emocionarme", emoji: "😢", value: "Drama", query: "algo para emocionarme" },
  { label: "Suspenso", emoji: "😱", value: "Suspenso", query: "algo de suspenso" },
  { label: "Aprender", emoji: "🧠", value: "Documental", query: "algo para aprender" },
  { label: "Lo que sea", emoji: "🎬", value: "", query: "lo mejor para esta noche" },
];

const ALL_PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];

type Screen = "welcome" | "tv" | "platforms" | "mood" | "magic";

interface RecoResult {
  main: Recommendation;
  poster: string | null;
}

function WizardPage() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [tvConnected, setTvConnected] = useState(false);
  const [withTV, setWithTV] = useState(true);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecoResult | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tvUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tv?s=${SESSION_ID}`
      : `/tv?s=${SESSION_ID}`;

  // Connect to Supabase Realtime on mount
  useEffect(() => {
    const ch = supabase
      .channel(`cinefilo:session:${SESSION_ID}`)
      .on("broadcast", { event: "tv_ready" }, () => {
        setTvConnected(true);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
      })
      .subscribe();
    channelRef.current = ch;
    return () => {
      void supabase.removeChannel(ch);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, []);

  // Ping the TV every 2s while on the TV screen
  useEffect(() => {
    if (screen !== "tv") {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      return;
    }
    if (tvConnected) return;

    const ping = () => {
      void channelRef.current?.send({
        type: "broadcast",
        event: "wizard_ping",
        payload: {},
      });
    };
    ping();
    pingIntervalRef.current = setInterval(ping, 2000);
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [screen, tvConnected]);

  const broadcastToTV = async (payload: Record<string, unknown>) => {
    await channelRef.current?.send({
      type: "broadcast",
      event: "message",
      payload,
    });
  };

  const getReco = async (moodQuery: string, moodValue: string) => {
    setLoading(true);
    try {
      const effectivePlatforms = platforms.length > 0 ? platforms : ALL_PLATFORMS;
      const ctx = inferContext();
      const msg = `Quiero ver ${moodQuery} en ${effectivePlatforms.join(", ")}.`;

      const data = await recommendConversational({
        data: {
          messages: [{ role: "user", content: msg }],
          platforms: effectivePlatforms,
          contextHint: contextToPromptHint(ctx),
          seasonHint: seasonHintShort(ctx),
          weatherHint: null,
          excludeTitles: excluded,
        },
      });

      if (!data?.main) throw new Error("Sin resultado");

      const posters = await fetchPostersClient([
        { title: data.main.title, type: data.main.type, year: data.main.year },
      ]);
      const poster = posters[data.main.title] ?? null;

      setResult({ main: data.main, poster });
      setExcluded((prev) => [...prev, data.main.title]);
      setScreen("magic");

      if (withTV) {
        await broadcastToTV({
          type: "recommendation",
          title: data.main.title,
          platform: data.main.platform,
          reason: data.main.reason,
          poster,
        });
      }
    } catch (e) {
      console.error("[wizard] getReco error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (!result) return;
    const currentMood = MOODS.find((m) => excluded.length > 0 ? true : false);
    // Re-use last mood query from state isn't tracked, so use generic "lo mejor"
    await getReco("lo mejor para esta noche", "");
  };

  // ── SCREEN: WELCOME ──────────────────────────────────────────────
  if (screen === "welcome") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-background px-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <Sparkles className="h-10 w-10 text-primary" />
          <h1 className="text-4xl font-bold tracking-tight">Cinéfilo</h1>
        </div>
        <p className="text-xl leading-snug text-muted-foreground">
          Decidí qué ver esta noche<br />en 3 pasos.
        </p>
        <button
          onClick={() => setScreen("tv")}
          className="rounded-full bg-foreground px-12 py-4 text-base font-semibold text-background"
        >
          Empezar
        </button>
      </div>
    );
  }

  // ── SCREEN: CONNECT TV ───────────────────────────────────────────
  if (screen === "tv") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-8">
        <Tv className="h-12 w-12 text-foreground/30" />
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">¿A qué TV conectamos?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Abrí esta URL en la laptop conectada al TV:
          </p>
        </div>

        <div className="w-full max-w-sm rounded-2xl bg-muted p-4 text-center">
          <p className="break-all font-mono text-xs text-foreground/80">{tvUrl}</p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              tvConnected ? "bg-green-500" : "animate-pulse bg-muted-foreground/30"
            )}
          />
          <span className="text-sm text-muted-foreground">
            {tvConnected ? "TV conectada ✓" : "Esperando la TV..."}
          </span>
        </div>

        {tvConnected && (
          <button
            onClick={() => setScreen("platforms")}
            className="rounded-full bg-foreground px-12 py-4 text-base font-semibold text-background"
          >
            Continuar →
          </button>
        )}

        <button
          onClick={() => { setWithTV(false); setScreen("platforms"); }}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          Sin TV → Seguir igual
        </button>
      </div>
    );
  }

  // ── SCREEN: PLATFORMS ────────────────────────────────────────────
  if (screen === "platforms") {
    return (
      <div className="flex min-h-screen flex-col bg-background px-6 pt-14 pb-8">
        <h2 className="text-2xl font-bold tracking-tight">¿En qué plataformas estás?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Si no elegís ninguna, buscamos en todas.</p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {PLATFORMS.map((p) => {
            const selected = platforms.includes(p);
            return (
              <button
                key={p}
                onClick={() =>
                  setPlatforms((prev) =>
                    selected ? prev.filter((x) => x !== p) : [...prev, p]
                  )
                }
                className={cn(
                  "rounded-2xl border-2 px-2 py-4 text-sm font-semibold transition-all",
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground"
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setScreen("mood")}
          className="mt-auto w-full rounded-full bg-foreground py-4 text-base font-semibold text-background"
        >
          Continuar →
        </button>
      </div>
    );
  }

  // ── SCREEN: MOOD ─────────────────────────────────────────────────
  if (screen === "mood") {
    return (
      <div className="flex min-h-screen flex-col bg-background px-6 pt-14 pb-8">
        <h2 className="text-2xl font-bold tracking-tight">¿Qué te copa esta noche?</h2>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {MOODS.map((m) => (
            <button
              key={m.label}
              onClick={() => getReco(m.query, m.value)}
              disabled={loading}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-border bg-background py-6 text-center transition-all active:scale-95 disabled:opacity-40"
            >
              <span className="text-4xl">{m.emoji}</span>
              <span className="text-sm font-semibold">{m.label}</span>
            </button>
          ))}
        </div>

        {loading && (
          <div className="mt-6 flex items-center justify-center gap-2 text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span className="text-sm">Buscando la mejor opción...</span>
          </div>
        )}
      </div>
    );
  }

  // ── SCREEN: MAGIC MOMENT ─────────────────────────────────────────
  if (screen === "magic" && result) {
    const { main, poster } = result;
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-2 px-6 pt-10 pb-2">
          <span className="text-green-500 text-lg">✓</span>
          <span className="font-semibold text-foreground">Todo listo.</span>
          {withTV && tvConnected && (
            <span className="ml-auto text-xs text-muted-foreground">📺 En tu TV</span>
          )}
        </div>

        {/* Recommendation card */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4">
          {poster && (
            <img
              src={poster}
              alt={main.title}
              className="h-52 w-full rounded-2xl object-cover shadow-lg"
            />
          )}
          <div>
            <h2 className="text-2xl font-bold leading-tight tracking-tight">{main.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {main.platform} · {main.duration}
            </p>
          </div>
          <p className="text-[15px] leading-relaxed text-foreground/70">{main.reason}</p>

          {/* Commands */}
          <div className="flex gap-3">
            <a
              href={deepLinkFor(main.platform, main.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-full bg-foreground py-3.5 text-center text-sm font-semibold text-background"
            >
              ▶ Ver ahora
            </a>
            <button
              onClick={handleNext}
              disabled={loading}
              className="flex-1 rounded-full border-2 border-border py-3.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              ) : (
                "→ Siguiente"
              )}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="border-t border-border px-6 py-4">
          <button
            onClick={() => {
              setScreen("welcome");
              setResult(null);
              setExcluded([]);
              setPlatforms([]);
            }}
            className="w-full rounded-full border border-border py-3 text-sm text-muted-foreground"
          >
            🎤 Buscar algo específico
          </button>
        </div>
      </div>
    );
  }

  return null;
}
