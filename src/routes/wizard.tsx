import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { recommendConversational, askAboutTitle } from "@/lib/recommendations.functions";
import { fetchPosters } from "@/lib/posters.functions";
import { deepLinkFor, colorForPlatform } from "@/lib/recommendations";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import { MicButton } from "@/components/MicButton";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/recommendations";

export const Route = createFileRoute("/wizard")({
  component: WizardPage,
});

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];
const ALL_PLATFORMS = PLATFORMS;
const COUNTRY_KEY = "cinefilo:country";
const PLATFORMS_KEY = "queveo:guest:default_platforms";

type Screen = "welcome" | "platforms" | "magic";

async function detectCountry(): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(COUNTRY_KEY)) return;
  try {
    const res = await fetch("https://ipapi.co/country/", { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const code = (await res.text()).trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) localStorage.setItem(COUNTRY_KEY, code);
    }
  } catch {
    // non-blocking
  }
}

function WizardPage() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [platforms, setPlatforms] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(PLATFORMS_KEY);
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatText, setChatText] = useState("");
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ title: string; question: string; answer: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const touchStartX = useRef(0);

  useEffect(() => { void detectCountry(); }, []);

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
        data: {
          title: current.title,
          platform: current.platform,
          userQuestion: userQuery,
          history: detailHistory,
        },
      });
      setAgentReply(text);
      setDetailHistory((prev) => [...prev, { title: current.title, question: userQuery, answer: text }]);
    } catch (e) {
      console.error("[wizard/ask]", e);
    } finally {
      setLoading(false);
    }
  };

  const getReco = async (userQuery: string) => {
    setAgentReply(null);
    setDetailHistory([]);
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

      const { posters: finalPosters } = await fetchPosters({
        data: { items: allItems.map((i) => ({ title: i.title, type: i.type, year: i.year })) },
      });
      setPosters(finalPosters);
    } catch (e) {
      console.error("[wizard]", e);
      setLoading(false);
    }
  };

  const navigate = (newIndex: number) => {
    setCurrentIndex(newIndex);
    setAgentReply(null);
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

  const handleStartReco = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    }
    const ctx = inferContext();
    const contextQuery = `lo mejor para ${contextToPromptHint(ctx) || "esta noche"}`;
    void getReco(contextQuery);
  };

  // ── WELCOME ──────────────────────────────────────────────────────────
  if (screen === "welcome") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-10 bg-background px-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <Sparkles className="h-12 w-12 text-primary" />
          <h1 className="text-5xl font-bold tracking-tight">Miru</h1>
          <p className="text-lg leading-snug text-muted-foreground">
            Tu guía personal para elegir<br />qué ver esta noche.
          </p>
        </div>
        <button
          onClick={() => setScreen("platforms")}
          className="rounded-full bg-foreground px-14 py-4 text-base font-semibold text-background active:scale-95 transition-transform"
        >
          Empezar
        </button>
      </div>
    );
  }

  // ── PLATFORMS ────────────────────────────────────────────────────────
  if (screen === "platforms") {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background px-6 pt-16 pb-10">
        <h2 className="text-2xl font-bold tracking-tight">¿Cuáles tenés?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Seleccioná tus plataformas. Si no elegís ninguna, buscamos en todas.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {PLATFORMS.map((p) => {
            const selected = platforms.includes(p);
            const color = colorForPlatform(p);
            return (
              <button
                key={p}
                onClick={() =>
                  setPlatforms((prev) =>
                    selected ? prev.filter((x) => x !== p) : [...prev, p]
                  )
                }
                className={cn(
                  "rounded-2xl border-2 px-4 py-5 text-left text-sm font-semibold transition-all active:scale-95",
                  selected
                    ? "border-transparent text-white"
                    : "border-border bg-background text-foreground"
                )}
                style={selected ? { backgroundColor: color, borderColor: color } : {}}
              >
                {p}
              </button>
            );
          })}
        </div>

        <div className="mt-auto pt-8">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
              <p className="text-sm text-muted-foreground">Buscando las mejores opciones...</p>
            </div>
          ) : (
            <button
              onClick={handleStartReco}
              className="w-full rounded-full bg-foreground py-4 text-base font-semibold text-background active:scale-95 transition-transform"
            >
              Empezar →
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── MAGIC MOMENT ─────────────────────────────────────────────────────
  if (screen === "magic" && items.length > 0) {
    const current = items[currentIndex];
    const poster = posters[current.title];
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < items.length - 1;
    const platformColor = colorForPlatform(current.platform);

    return (
      <div className="flex h-[100dvh] flex-col bg-background">

        {/* Header */}
        <div className="flex shrink-0 items-center px-5 pt-6 pb-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold">Miru</span>
          </div>
        </div>

        {/* Agent input */}
        <div className="shrink-0 px-5 pt-3 pb-3">
          <div className={cn("flex items-center gap-3", loading && "opacity-50 pointer-events-none")}>
            <MicButton
              size="md"
              className="h-12 w-12 shrink-0"
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
            <div className="flex flex-1 items-center gap-2 rounded-2xl bg-muted px-4">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
                placeholder={loading ? "Pensando..." : "Más oscuro · ¿de qué trata? · nuevo set..."}
                disabled={loading}
                className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
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

        {/* Hero card + reply */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-2">
          <div
            className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-border bg-muted/30 select-none"
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - touchStartX.current;
              if (dx < -50 && hasNext) navigate(currentIndex + 1);
              else if (dx > 50 && hasPrev) navigate(currentIndex - 1);
            }}
          >
            <div className="flex h-full">
              <div className="w-28 shrink-0 overflow-hidden">
                {poster ? (
                  <img src={poster} alt={current.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full animate-pulse bg-muted" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                <h2 className="text-base font-bold leading-tight">{current.title}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: platformColor }}
                  >
                    {current.platform === "Star+" ? "Disney+" : current.platform}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {current.type} · {current.duration}
                    {current.year && ` · ${current.year}`}
                  </span>
                  {current.ageRating && (
                    <span className="rounded border border-muted-foreground/30 px-1 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
                      {current.ageRating}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-foreground/70 line-clamp-4">
                  {current.reason}
                </p>
                <a
                  href={deepLinkFor(current.platform, current.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 w-full rounded-full py-2.5 text-center text-xs font-bold text-white"
                  style={{ backgroundColor: platformColor }}
                >
                  ▶ Ver ahora en {current.platform === "Star+" ? "Disney+" : current.platform}
                </a>
              </div>
            </div>
          </div>

          {agentReply ? (
            <div className="shrink-0 rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3">
              <p className="text-sm leading-snug text-foreground/90">{agentReply}</p>
            </div>
          ) : (
            <p className="shrink-0 text-center text-[10px] text-muted-foreground/40">
              deslizá para ver alternativas
            </p>
          )}
        </div>

        {/* Navigation */}
        <div className="shrink-0 px-5 pt-2 pb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(currentIndex - 1)}
              disabled={!hasPrev}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-border font-semibold transition-transform active:scale-95 disabled:opacity-20"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm">Anterior</span>
            </button>

            <div className="flex flex-col items-center gap-1.5 px-2">
              <span className="text-sm font-bold">
                {currentIndex + 1}
                <span className="font-normal text-muted-foreground">/{items.length}</span>
              </span>
              <div className="flex gap-1">
                {items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(i)}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      i === currentIndex ? "w-4 bg-foreground" : "w-1.5 bg-foreground/20"
                    )}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={() => navigate(currentIndex + 1)}
              disabled={!hasNext}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-border font-semibold transition-transform active:scale-95 disabled:opacity-20"
            >
              <span className="text-sm">Siguiente</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

      </div>
    );
  }

  // Transitional loading state
  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background">
        <Sparkles className="h-8 w-8 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">Buscando las mejores opciones...</p>
      </div>
    );
  }

  return null;
}
