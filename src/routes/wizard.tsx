import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Tv, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recommendConversational, askAboutTitle } from "@/lib/recommendations.functions";
import { deepLinkFor } from "@/lib/recommendations";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import { fetchPosterClient } from "@/lib/itunes";
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
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef(0);

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

  // Detect if the user is asking for details about the current movie vs new recommendations
  const isDetailQuery = (q: string) => {
    const t = q.toLowerCase();
    return /contame|explicame|explicá|por qu[eé]|porque|de qu[eé] trata|sinopsis|argumento|director|reparto|cast|quién|quien|cu[aá]ndo|vale la pena|recomend[aá]s|te gusta|opinion|opini[oó]n|buena[?]?$|m[aá]s info|mejor escena|temática|estilo|comparar|similar/.test(t);
  };

  const askAbout = async (userQuery: string) => {
    if (items.length === 0) return;
    setLoading(true);
    const current = items[currentIndex];
    try {
      const { text } = await askAboutTitle({
        data: { title: current.title, platform: current.platform, userQuestion: userQuery },
      });
      setAgentReply(text);
    } catch (e) {
      console.error("[wizard/ask]", e);
    } finally {
      setLoading(false);
    }
  };

  const getReco = async (userQuery: string) => {
    setAgentReply(null);
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
      const assistantSummary = `Recomendé: ${data.main.title} y ${(data.alternatives ?? []).slice(0, 4).map((a) => a.title).join(", ")}.`;
      setMessages([...newMessages, { role: "assistant", content: assistantSummary }]);
      setItems(allItems);
      setPosters({});
      setCurrentIndex(0);
      setScreen("magic");
      setLoading(false);

      // Load posters progressively — each one updates state as it arrives
      const finalPosters: Record<string, string | null> = {};
      await Promise.all(
        allItems.map(async (item) => {
          const poster = await fetchPosterClient(item.title, item.type, item.year);
          finalPosters[item.title] = poster;
          setPosters((prev) => ({ ...prev, [item.title]: poster }));
        })
      );

      if (withTV) {
        await broadcast({
          type: "results",
          items: allItems,
          posters: finalPosters,
          selectedIndex: 0,
        });
      }
    } catch (e) {
      console.error("[wizard]", e);
      setLoading(false);
    }
  };

  const navigate = async (newIndex: number) => {
    setCurrentIndex(newIndex);
    setAgentReply(null);
    if (withTV) await broadcast({ type: "select", index: newIndex });
  };

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || loading) return;
    setChatText("");
    if (screen === "magic" && isDetailQuery(text)) {
      await askAbout(text);
    } else {
      await getReco(text);
    }
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

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-6 pb-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold">Cinéfilo</span>
          </div>
          {withTV && tvConnected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-500">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              TV en vivo
            </span>
          )}
        </div>

        {/* ── Agente Cinéfilo (top, prominent) ── */}
        <div className="shrink-0 px-5 pt-4 pb-3">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Agente Cinéfilo
          </p>
          <div className={cn("flex items-center gap-3", loading && "opacity-50 pointer-events-none")}>
            {/* Prominent mic */}
            <MicButton
              size="md"
              mode="push"
              className="h-14 w-14 shrink-0"
              onTranscript={(t, isFinal) => {
                if (!t) { setChatText(""); return; }
                if (isFinal) {
                  const q = t.trim();
                  if (isDetailQuery(q)) void askAbout(q);
                  else void getReco(q);
                  setChatText("");
                } else {
                  setChatText(t);
                }
              }}
            />
            {/* Text input */}
            <div className="flex flex-1 items-center gap-2 rounded-2xl bg-muted px-4">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
                placeholder={loading ? "Pensando..." : "Más oscuro · ¿de qué trata? · nuevo set..."}
                disabled={loading}
                className="min-h-[46px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
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

        {/* ── Mini hero card — swipeable ── */}
        <div
          className="mx-5 flex-1 overflow-hidden rounded-2xl border border-border bg-muted/30 select-none"
          onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            if (dx < -50 && hasNext) void navigate(currentIndex + 1);
            else if (dx > 50 && hasPrev) void navigate(currentIndex - 1);
          }}
        >
          <div className="flex h-full">
            {/* Poster */}
            <div className="w-28 shrink-0 overflow-hidden">
              {poster ? (
                <img src={poster} alt={current.title} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full animate-pulse bg-muted" />
              )}
            </div>
            {/* Info */}
            <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
              <h2 className="text-base font-bold leading-tight">{current.title}</h2>
              <p className="text-xs text-muted-foreground">{current.platform} · {current.duration}</p>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-foreground/70 line-clamp-4">
                {current.reason}
              </p>
              <a
                href={deepLinkFor(current.platform, current.title)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 w-full rounded-full bg-foreground py-2.5 text-center text-xs font-semibold text-background"
              >
                ▶ Ver ahora
              </a>
            </div>
          </div>
        </div>
        {/* Agent reply bubble */}
        {agentReply && (
          <div className="mx-5 mt-2 rounded-2xl bg-primary/8 border border-primary/20 px-4 py-3">
            <p className="text-sm leading-snug text-foreground/90">{agentReply}</p>
          </div>
        )}
        {/* Swipe hint */}
        {!agentReply && (
          <p className="shrink-0 pt-1.5 text-center text-[10px] text-muted-foreground/40">
            deslizá para cambiar · o usá los botones
          </p>
        )}

        {/* ── TV navigation commands ── */}
        <div className="shrink-0 px-5 pt-3 pb-6">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Controlar la TV
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void navigate(currentIndex - 1)}
              disabled={!hasPrev}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-border font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-20"
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="text-sm">Anterior</span>
            </button>

            <div className="flex flex-col items-center gap-1.5 px-1">
              <span className="text-sm font-bold">
                {currentIndex + 1}
                <span className="font-normal text-muted-foreground">/{items.length}</span>
              </span>
              <div className="flex gap-1">
                {items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => void navigate(i)}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      i === currentIndex ? "w-4 bg-foreground" : "w-1.5 bg-foreground/20"
                    )}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={() => void navigate(currentIndex + 1)}
              disabled={!hasNext}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-border font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-20"
            >
              <span className="text-sm">Siguiente</span>
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

      </div>
    );
  }

  return null;
}
