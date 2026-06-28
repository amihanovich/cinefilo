import { useEffect, useRef, useState } from "react";
import { Sparkles, ChevronLeft, ChevronRight, Send, Mic } from "lucide-react";
import { inferContext, contextToPromptHint, seasonHintShort } from "./lib/context";
import { fetchRecommendation, fetchPosters } from "./lib/api";
import { colorForPlatform, platformLabel } from "./lib/deeplink";
import { jwSearch, openNative } from "./lib/justwatch";
import { VoiceRecorder, transcribe } from "./lib/stt";
import { VoiceAgentOverlay, type VoiceResult } from "./components/VoiceAgent";
import { Orb } from "./components/Orb";
import type { Recommendation, Message } from "./lib/api";
import type { JwResult } from "./lib/justwatch";

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];
const COUNTRY_KEY = "cinefilo:country";
const PLATFORMS_KEY = "queveo:guest:default_platforms";

type Screen = "welcome" | "platforms" | "magic";

async function detectCountry(): Promise<void> {
  if (localStorage.getItem(COUNTRY_KEY)) return;
  try {
    const res = await fetch("https://ipapi.co/country/", { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const code = (await res.text()).trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) localStorage.setItem(COUNTRY_KEY, code);
    }
  } catch {
    // silencioso
  }
}

function getCountry(): string {
  return localStorage.getItem(COUNTRY_KEY) ?? "AR";
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export default function WizardPage({ onComplete }: { onComplete?: () => void } = {}) {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [platforms, setPlatforms] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(PLATFORMS_KEY);
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState("");
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [cinephileNote, setCinephileNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [micRecording, setMicRecording] = useState(false);
  const touchStartX = useRef(0);
  const micRecorderRef = useRef<VoiceRecorder | null>(null);

  // Auto-advance welcome → platforms after 2s
  useEffect(() => {
    if (screen !== "welcome") return;
    void detectCountry();
    const timer = setTimeout(() => setScreen("platforms"), 2000);
    return () => clearTimeout(timer);
  }, [screen]);

  const loadAvailability = async (allItems: Recommendation[]) => {
    const country = getCountry();
    await Promise.allSettled(
      allItems.map(async (item) => {
        const result = await jwSearch(item.title, item.platform, item.type, country);
        setAvailability((prev) => ({ ...prev, [item.title]: result }));
      })
    );
  };

  const getReco = async (userQuery: string) => {
    setAgentReply(null);
    setCinephileNote(null);
    setLoading(true);
    const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
    const ctx = inferContext();
    const newMessages: Message[] = [...messages, { role: "user", content: userQuery }];

    try {
      const data = await fetchRecommendation({
        messages: newMessages,
        platforms: effectivePlatforms,
        contextHint: contextToPromptHint(ctx),
        seasonHint: seasonHintShort(ctx),
        weatherHint: null,
        excludeTitles: items.map((i) => i.title),
      });

      if (!data?.main) throw new Error("Sin resultado");

      const allItems = [data.main, ...(data.alternatives ?? []).slice(0, 4)];
      const assistantSummary = `Recomendé: ${data.main.title} y ${(data.alternatives ?? []).slice(0, 4).map((a) => a.title).join(", ")}.`;

      setMessages([...newMessages, { role: "assistant", content: assistantSummary }]);
      setItems(allItems);
      setPosters({});
      setAvailability({});
      setCurrentIndex(0);
      setCinephileNote(data.cinephile_note ?? null);
      setScreen("magic");
      setLoading(false);

      void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
      void loadAvailability(allItems);
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
    await getReco(text);
  };

  // Mic en el chat: graba → transcribe → pone el texto en el input (no auto-envía)
  const toggleMic = async () => {
    if (micRecording) {
      const recorder = micRecorderRef.current;
      if (!recorder) return;
      setMicRecording(false);
      const blob = await recorder.stop();
      micRecorderRef.current = null;
      if (blob.size < 500) return;
      try {
        const text = await transcribe(blob);
        if (text.trim()) setChatText(text.trim());
      } catch {
        // silencioso
      }
    } else {
      const recorder = new VoiceRecorder();
      micRecorderRef.current = recorder;
      setMicRecording(true);
      try {
        await recorder.start({
          onAutoStop: async () => {
            setMicRecording(false);
            const blob = await recorder.stop();
            micRecorderRef.current = null;
            if (blob.size < 500) return;
            try {
              const text = await transcribe(blob);
              if (text.trim()) setChatText(text.trim());
            } catch {
              // silencioso
            }
          },
          silenceMs: 2500,
        });
      } catch {
        setMicRecording(false);
        micRecorderRef.current = null;
      }
    }
  };

  // Callback del VoiceAgentOverlay: recibe items + nota y cierra el overlay
  const handleVoiceResult = (result: VoiceResult) => {
    const allItems = result.items;
    setItems(allItems);
    setPosters({});
    setAvailability({});
    setCurrentIndex(0);
    setMessages(result.messages);
    setCinephileNote(result.cinephileNote);
    setAgentReply(null);
    setScreen("magic");
    void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
    void loadAvailability(allItems);
  };

  const handleStartReco = () => {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    if (onComplete) { onComplete(); return; }
    const ctx = inferContext();
    void getReco(`lo mejor para ${contextToPromptHint(ctx) || "esta noche"}`);
  };

  // ── WELCOME ──────────────────────────────────────────────────────────
  if (screen === "welcome") {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-8 bg-background px-8 text-center safe-top safe-bottom">
        <div className="flex flex-col items-center gap-5">
          <Sparkles className="h-12 w-12 text-primary" />
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Hola, soy Cinéfilo.</h1>
            <p className="text-base text-muted-foreground leading-snug">
              Contame qué querés ver<br />y te ayudo a encontrarlo.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── PLATFORMS ────────────────────────────────────────────────────────
  if (screen === "platforms") {
    return (
      <div className="flex h-[100dvh] flex-col bg-background px-6 pt-16 pb-10 safe-top safe-bottom">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">¿Cuáles tenés?</h2>
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
                  selected ? "border-transparent text-white" : "border-border bg-background text-foreground"
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
    const avail = availability[current.title];
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < items.length - 1;
    const platformColor = colorForPlatform(current.platform);
    const label = platformLabel(current.platform);

    return (
      <div className="flex h-[100dvh] flex-col bg-background safe-top safe-bottom">

        {/* Voice overlay (opt-in) */}
        {voiceMode && (
          <VoiceAgentOverlay
            platforms={platforms.length > 0 ? platforms : PLATFORMS}
            excludeTitles={items.map((i) => i.title)}
            history={messages}
            onResult={(result) => { handleVoiceResult(result); setVoiceMode(false); }}
            onDismiss={() => setVoiceMode(false)}
          />
        )}

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-6 pb-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Cinéfilo</span>
          </div>

          {/* Botón "Hablar con Cinéfilo" */}
          <button
            onClick={() => setVoiceMode(true)}
            className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 transition-all active:scale-95 hover:bg-primary/10"
          >
            <Orb phase="idle" size="mini" />
            <span className="text-[11px] font-semibold text-primary">Hablar con Cinéfilo</span>
          </button>
        </div>

        {/* Chat input con mic de transcripción */}
        <div className="shrink-0 px-5 pt-3 pb-3">
          <div className={cn("flex items-center gap-2 rounded-2xl bg-muted px-3", loading && "opacity-50 pointer-events-none")}>
            {/* Mic de transcripción */}
            <button
              onClick={() => void toggleMic()}
              disabled={loading}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                micRecording ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={micRecording ? "Detener grabación" : "Grabar voz"}
            >
              <Mic className="h-4 w-4" />
            </button>

            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
              placeholder={
                micRecording ? "Escuchando..." :
                loading ? "Pensando..." :
                "Más oscuro · ¿de qué trata? · nuevo set..."
              }
              disabled={loading || micRecording}
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <button
              onClick={() => void sendChat()}
              disabled={!chatText.trim() || loading}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Hero card */}
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
                <h2 className="text-base font-bold leading-tight text-foreground">{current.title}</h2>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: platformColor }}
                  >
                    {label}
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

                <div className="mt-0.5">
                  {avail === undefined ? (
                    <span className="text-[10px] text-muted-foreground/50">Verificando disponibilidad...</span>
                  ) : avail.confirmed ? (
                    <span className="text-[10px] font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/50">⚠ No confirmado en tu región</span>
                  )}
                </div>

                <p className="mt-1 flex-1 text-[13px] leading-relaxed text-foreground/70 line-clamp-3">
                  {current.reason}
                </p>

                <button
                  onClick={() => {
                    if (avail?.confirmed) {
                      openNative(avail);
                    } else {
                      const q = encodeURIComponent(current.title);
                      const urls: Record<string, string> = {
                        Netflix: `https://www.netflix.com/search?q=${q}`,
                        "Prime Video": `https://www.primevideo.com/search/?phrase=${q}`,
                        "Disney+": `https://www.disneyplus.com/search`,
                        "Star+": `https://www.disneyplus.com/search`,
                        Max: `https://play.max.com/search?q=${q}`,
                        "Apple TV+": `https://tv.apple.com/search?term=${q}`,
                        "Paramount+": `https://www.paramountplus.com/search/${q}/`,
                      };
                      window.open(urls[current.platform] ?? `https://www.google.com/search?q=${q}+ver+online`, "_blank");
                    }
                  }}
                  className="mt-2 w-full rounded-full py-2.5 text-center text-xs font-bold text-white active:scale-95 transition-transform"
                  style={{ backgroundColor: platformColor }}
                >
                  ▶ Ver ahora en {label}
                </button>
              </div>
            </div>
          </div>

          <p className="shrink-0 text-center text-[10px] text-muted-foreground/40">
            deslizá para ver alternativas
          </p>
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
              <span className="text-sm font-bold text-foreground">
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

  // Loading state
  if (loading) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background">
        <Sparkles className="h-8 w-8 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">Buscando las mejores opciones...</p>
      </div>
    );
  }

  return null;
}
