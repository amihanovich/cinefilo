import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Tv, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recommendConversational } from "@/lib/recommendations.functions";
import { deepLinkFor } from "@/lib/recommendations";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import { fetchPostersClient } from "@/lib/itunes";
import { MicButton } from "@/components/MicButton";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/recommendations";

export const Route = createFileRoute("/wizard")({
  component: WizardPage,
});

const SESSION_ID = "cinefilo-test";

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];
const ALL_PLATFORMS = PLATFORMS;

const MOODS = [
  { label: "Reírme", emoji: "😂", query: "una comedia para reírme" },
  { label: "Sorprenderme", emoji: "😮", query: "algo que me sorprenda" },
  { label: "Emocionarme", emoji: "😢", query: "algo para emocionarme" },
  { label: "Suspenso", emoji: "😱", query: "algo de suspenso" },
  { label: "Aprender", emoji: "🧠", query: "algo para aprender" },
  { label: "Lo que sea", emoji: "🎬", query: "lo mejor para esta noche" },
];

type Screen = "welcome" | "tv" | "platforms" | "mood" | "magic";

function WizardPage() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [tvConnected, setTvConnected] = useState(false);
  const [withTV, setWithTV] = useState(true);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatText, setChatText] = useState("");
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tvUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tv?s=${SESSION_ID}`
      : `/tv?s=${SESSION_ID}`;

  useEffect(() => {
    const ch = supabase
      .channel(`cinefilo:session:${SESSION_ID}`)
      .on("broadcast", { event: "tv_ready" }, () => {
        setTvConnected(true);
        if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      })
      .subscribe();
    channelRef.current = ch;
    return () => { void supabase.removeChannel(ch); if (pingIntervalRef.current) clearInterval(pingIntervalRef.current); };
  }, []);

  useEffect(() => {
    if (screen !== "tv" || tvConnected) { if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; } return; }
    const ping = () => void channelRef.current?.send({ type: "broadcast", event: "wizard_ping", payload: {} });
    ping();
    pingIntervalRef.current = setInterval(ping, 2000);
    return () => { if (pingIntervalRef.current) clearInterval(pingIntervalRef.current); };
  }, [screen, tvConnected]);

  const broadcast = async (payload: Record<string, unknown>) => {
    await channelRef.current?.send({ type: "broadcast", event: "message", payload });
  };

  const getReco = async (userQuery: string) => {
    setLoading(true);
    const effectivePlatforms = platforms.length > 0 ? platforms : ALL_PLATFORMS;
    const ctx = inferContext();
    const newMessages = [...messages, { role: "user" as const, content: userQuery }];

    try {
      const data = await recommendConversational({
        data: {
          messages: newMessages,
          platforms: effectivePlatforms,
          contextHint: contextToPromptHint(ctx),
          seasonHint: seasonHintShort(ctx),
          weatherHint: null,
          excludeTitles: items.map((i) => i.title),
        },
      });

      if (!data?.main) throw new Error("Sin resultado");

      const allItems = [data.main, ...(data.alternatives ?? []).slice(0, 4)];
      const posterMap = await fetchPostersClient(
        allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))
      );

      const assistantSummary = `Recomendé: ${data.main.title} y ${(data.alternatives ?? []).slice(0, 4).map((a) => a.title).join(", ")}.`;
      setMessages([...newMessages, { role: "assistant", content: assistantSummary }]);
      setItems(allItems);
      setPosters(posterMap);
      setCurrentIndex(0);
      setScreen("magic");

      if (withTV) {
        await broadcast({
          type: "results",
          items: allItems,
          posters: posterMap,
          selectedIndex: 0,
        });
      }
    } catch (e) {
      console.error("[wizard]", e);
    } finally {
      setLoading(false);
    }
  };

  const navigate = async (newIndex: number) => {
    setCurrentIndex(newIndex);
    if (withTV) await broadcast({ type: "select", index: newIndex });
  };

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || loading) return;
    setChatText("");
    await getReco(text);
  };

  // ── WELCOME ────────────────────────────────────────────────────────
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

  // ── CONNECT TV ─────────────────────────────────────────────────────
  if (screen === "tv") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-8">
        <Tv className="h-12 w-12 text-foreground/30" />
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">¿A qué TV conectamos?</h2>
          <p className="mt-2 text-sm text-muted-foreground">Abrí esta URL en la laptop conectada al TV:</p>
        </div>
        <div className="w-full max-w-sm rounded-2xl bg-muted p-4 text-center">
          <p className="break-all font-mono text-xs text-foreground/80">{tvUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", tvConnected ? "bg-green-500" : "animate-pulse bg-muted-foreground/30")} />
          <span className="text-sm text-muted-foreground">{tvConnected ? "TV conectada ✓" : "Esperando la TV..."}</span>
        </div>
        {tvConnected && (
          <button onClick={() => setScreen("platforms")} className="rounded-full bg-foreground px-12 py-4 text-base font-semibold text-background">
            Continuar →
          </button>
        )}
        <button onClick={() => { setWithTV(false); setScreen("platforms"); }} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          Sin TV → Seguir igual
        </button>
      </div>
    );
  }

  // ── PLATFORMS ──────────────────────────────────────────────────────
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
                onClick={() => setPlatforms((prev) => selected ? prev.filter((x) => x !== p) : [...prev, p])}
                className={cn("rounded-2xl border-2 px-2 py-4 text-sm font-semibold transition-all", selected ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground")}
              >
                {p}
              </button>
            );
          })}
        </div>
        <button onClick={() => setScreen("mood")} className="mt-auto w-full rounded-full bg-foreground py-4 text-base font-semibold text-background">
          Continuar →
        </button>
      </div>
    );
  }

  // ── MOOD ───────────────────────────────────────────────────────────
  if (screen === "mood") {
    return (
      <div className="flex min-h-screen flex-col bg-background px-6 pt-14 pb-8">
        <h2 className="text-2xl font-bold tracking-tight">¿Qué te copa esta noche?</h2>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {MOODS.map((m) => (
            <button
              key={m.label}
              onClick={() => getReco(m.query)}
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
            <span className="text-sm">Buscando las mejores opciones...</span>
          </div>
        )}
      </div>
    );
  }

  // ── MAGIC MOMENT ───────────────────────────────────────────────────
  if (screen === "magic" && items.length > 0) {
    const current = items[currentIndex];
    const poster = posters[current.title];
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < items.length - 1;

    return (
      <div className="flex h-[100dvh] flex-col bg-background">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-8 pb-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[15px] font-semibold">Cinéfilo</span>
          </div>
          {withTV && tvConnected && <span className="text-xs text-muted-foreground">📺 TV sincronizada</span>}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2">
          {poster && (
            <img src={poster} alt={current.title} className="h-48 w-full rounded-2xl object-cover shadow-md" />
          )}

          {/* Nav + title */}
          <div className="flex items-start gap-3">
            <div className="flex shrink-0 items-center gap-1 pt-1">
              <button
                onClick={() => navigate(currentIndex - 1)}
                disabled={!hasPrev}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-20"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-xs text-muted-foreground">{currentIndex + 1}/{items.length}</span>
              <button
                onClick={() => navigate(currentIndex + 1)}
                disabled={!hasNext}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-20"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold leading-tight">{current.title}</h2>
              <p className="text-sm text-muted-foreground">{current.platform} · {current.duration}</p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-foreground/70">{current.reason}</p>

          <a
            href={deepLinkFor(current.platform, current.title)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-full bg-foreground py-3.5 text-center text-sm font-semibold text-background"
          >
            ▶ Ver ahora
          </a>

          {/* Alternatives dots */}
          <div className="flex justify-center gap-1.5 py-1">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => navigate(i)}
                className={cn("h-2 rounded-full transition-all", i === currentIndex ? "w-5 bg-foreground" : "w-2 bg-foreground/20")}
              />
            ))}
          </div>
        </div>

        {/* AI Agent chat */}
        <div className="shrink-0 border-t border-border px-5 py-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Hablá con Cinéfilo
          </p>
          <div className={cn("flex items-center gap-2 rounded-2xl bg-muted px-4 transition-opacity", loading && "opacity-50 pointer-events-none")}>
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
              placeholder={loading ? "Pensando..." : "Dame algo más oscuro, algo con Villeneuve..."}
              disabled={loading}
              className="min-h-[48px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <MicButton
              size="sm"
              onTranscript={(t, isFinal) => {
                if (!t) { setChatText(""); return; }
                if (isFinal) { void getReco(t.trim()); setChatText(""); }
                else setChatText(t);
              }}
            />
            <button
              onClick={sendChat}
              disabled={!chatText.trim() || loading}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
