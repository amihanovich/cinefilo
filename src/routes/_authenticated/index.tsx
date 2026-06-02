import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ArrowUp,
  ThumbsUp,
  ThumbsDown,
  Heart,
  Eye,
  Bookmark,
  RefreshCw,
  ExternalLink,
  MapPin,
  RotateCcw,
} from "lucide-react";
import { SwipeCardDeck } from "@/components/SwipeCardDeck";
import type { SwipeItem } from "@/components/SwipeCardDeck";
import { SocialModeToggle } from "@/components/SocialModeToggle";
import { SocialMatchOverlay } from "@/components/SocialMatchOverlay";
import { findNearbyMatch } from "@/lib/social.functions";
import type { SocialMatchRow } from "@/lib/social.functions";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  PLATFORM_OPTIONS,
  colorForPlatform,
  deepLinkFor,
  type Platform,
  type RecommendationsResult,
} from "@/lib/recommendations";
import { recommendConversational } from "@/lib/recommendations.functions";
import { recordTitleFeedback } from "@/lib/feedback.functions";
import { getProfile, setDefaultPlatforms } from "@/lib/profile.functions";
import { VoiceOrb } from "@/components/VoiceOrb";
import { PosterMarquee } from "@/components/PosterMarquee";
import { PlatformOrbit } from "@/components/PlatformOrbit";
import { fetchPostersClient } from "@/lib/itunes";
import {
  readGuestSeed,
  seedForServer,
  bumpSearchCount,
  dismissLoginNudge,
} from "@/lib/guestSeed";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import { getContextualSuggestions } from "@/lib/suggestions";
import { readRecentSearches, pushRecentSearch, clearRecentSearches } from "@/lib/recentSearches";
import {
  getWeatherSnapshot,
  isWeatherEnabled,
  setWeatherEnabled,
  weatherHintShort,
  type WeatherSnapshot,
} from "@/lib/environment";
import { cn } from "@/lib/utils";
import { MicButton } from "@/components/MicButton";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

type FeedbackSentiment = "love" | "like" | "dislike" | "seen" | "watchlist";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  data?: RecommendationsResult;
  feedbackGiven?: Record<string, FeedbackSentiment>;
  deckItems?: SwipeItem[];
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const WATCHLIST_KEY = "cinefilo:watchlist";
function addToWatchlist(title: string) {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(title)) localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...list, title]));
  } catch { /* noop */ }
}
function readWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

const GUEST_PLATFORMS_KEY = "queveo:guest:default_platforms";

function readGuestPlatforms(): Platform[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(GUEST_PLATFORMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Platform[]) : [];
  } catch {
    return [];
  }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function HomePage() {
  const qc = useQueryClient();
  const [step, setStep] = useState<"home" | "chat">("home");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});

  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  const isGuest = sessionReady && !session;

  const [guestPlatforms, setGuestPlatforms] = useState<Platform[]>(() => readGuestPlatforms());
  const [guestSeedVersion, setGuestSeedVersion] = useState(0);

  const [showLoginNudge, setShowLoginNudge] = useState(false);
  useEffect(() => {
    if (!sessionReady || !isGuest) { setShowLoginNudge(false); return; }
    const seed = readGuestSeed();
    setShowLoginNudge(seed.searchCount >= 3 && !seed.loginNudgeDismissedAt);
  }, [sessionReady, isGuest, guestSeedVersion]);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
    enabled: !!session,
  });
  const defaultPlatforms = (isGuest ? guestPlatforms : (profile?.default_platforms ?? [])) as Platform[];

  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  useEffect(() => {
    if (defaultPlatforms.length > 0 && selectedPlatforms.length === 0) {
      setSelectedPlatforms(defaultPlatforms);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPlatforms.join(",")]);

  const effectivePlatforms =
    selectedPlatforms.length > 0 ? selectedPlatforms : (PLATFORM_OPTIONS as Platform[]);

  const [useLocation, setUseLocation] = useState(() => isWeatherEnabled());
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  useEffect(() => {
    if (!useLocation) return;
    setWeatherLoading(true);
    getWeatherSnapshot().then(setWeather).finally(() => setWeatherLoading(false));
  }, [useLocation]);

  const toggleLocation = async (enabled: boolean) => {
    setWeatherEnabled(enabled);
    setUseLocation(enabled);
    if (!enabled) { setWeather(null); return; }
    setWeatherLoading(true);
    setWeather(await getWeatherSnapshot());
    setWeatherLoading(false);
  };

  useEffect(() => {
    const handler = () => {
      setStep("home");
      setMessages([]);
      setInputText("");
      setExcluded([]);
      setPosters({});
    };
    window.addEventListener("que-veo:go-home", handler);
    return () => window.removeEventListener("que-veo:go-home", handler);
  }, []);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;

    const isFirstMessage = step === "home";
    // Guardamos solo la frase que inicia una búsqueda nueva (desde la home),
    // no cada turno de refinamiento del chat.
    if (isFirstMessage) pushRecentSearch(trimmed);
    const userMsg: ChatMessage = { id: uid(), role: "user", text: trimmed };
    const nextMessages = [...messages, userMsg];

    setInputText("");
    setIsLoading(true);
    // For subsequent turns in chat: show user message immediately
    if (!isFirstMessage) setMessages(nextMessages);

    const ctx = inferContext();
    const aiHistory = nextMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        m.role === "user"
          ? m.text
          : m.data
            ? `Recomendé: ${m.data.main.title} (${m.data.main.platform}), alternativas: ${m.data.alternatives.map((a) => `${a.title} (${a.platform})`).join(", ")}`
            : m.text,
    }));

    try {
      const data = await recommendConversational({
        data: {
          messages: aiHistory,
          platforms: effectivePlatforms,
          contextHint: contextToPromptHint(ctx),
          seasonHint: seasonHintShort(ctx),
          weatherHint: weather ? weatherHintShort(weather) : null,
          excludeTitles: excluded,
          profileSeed: isGuest ? seedForServer(readGuestSeed()) : undefined,
        },
      });

      const deckItems: SwipeItem[] = shuffle([
        { rec: data.main, isMain: true },
        ...data.alternatives.map((r) => ({ rec: r, isMain: false })),
      ]);
      const aiMsg: ChatMessage = { id: uid(), role: "assistant", text: "", data, feedbackGiven: {}, deckItems };

      if (isFirstMessage) {
        // Transition to chat only after result is ready
        setMessages([userMsg, aiMsg]);
        setStep("chat");
      } else {
        setMessages((prev) => [...prev, aiMsg]);
      }

      setExcluded((prev) => {
        const newTitles = [data.main.title, ...data.alternatives.map((a) => a.title)];
        return [...prev, ...newTitles.filter((t) => !prev.includes(t))];
      });

      // Load posters in background after result appears
      fetchPostersClient([
        { title: data.main.title, type: data.main.type },
        ...data.alternatives.map((a) => ({ title: a.title, type: a.type })),
      ]).then((map) => setPosters((prev) => ({ ...prev, ...map })));

      if (isGuest) {
        bumpSearchCount();
        setGuestSeedVersion((v) => v + 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Algo salió mal.";
      toast.error(msg, { duration: 6000 });
      if (!isFirstMessage) setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = (
    msgId: string,
    title: string,
    platform: string,
    sentiment: FeedbackSentiment,
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, feedbackGiven: { ...(m.feedbackGiven ?? {}), [title]: sentiment } }
          : m,
      ),
    );
    if (sentiment === "watchlist") {
      addToWatchlist(title);
      toast.success(`"${title}" guardado para ver después`, { duration: 2000 });
      return;
    }
    void recordTitleFeedback({ data: { title, platform, sentiment } }).catch(() => {});
    if (sentiment === "dislike" || sentiment === "seen") {
      setExcluded((prev) => (prev.includes(title) ? prev : [...prev, title]));
    }
  };

  const saveDefaultPlatforms = async (plats: Platform[]) => {
    if (isGuest) {
      localStorage.setItem(GUEST_PLATFORMS_KEY, JSON.stringify(plats));
      setGuestPlatforms(plats);
      return;
    }
    await setDefaultPlatforms({ data: { platforms: plats } });
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  return (
    <main className="min-h-[calc(100vh-57px)]">
      {step === "home" && (
        <HomeScreen
          onSubmit={submit}
          isLoading={isLoading}
          selectedPlatforms={selectedPlatforms}
          defaultPlatforms={defaultPlatforms}
          onSelectedPlatformsChange={setSelectedPlatforms}
          onSaveDefaultPlatforms={saveDefaultPlatforms}
          useLocation={useLocation}
          weather={weather}
          weatherLoading={weatherLoading}
          onToggleLocation={toggleLocation}
          isGuest={isGuest}
          showLoginNudge={showLoginNudge}
          onDismissLoginNudge={() => { dismissLoginNudge(); setShowLoginNudge(false); }}
        />
      )}

      {step === "chat" && (
        <ChatScreen
          messages={messages}
          isLoading={isLoading}
          isGuest={isGuest}
          session={session}
          posters={posters}
          onSubmit={submit}
          onFeedback={handleFeedback}
          onNewSearch={() => {
            setStep("home");
            setMessages([]);
            setInputText("");
            setExcluded([]);
            setPosters({});
          }}
        />
      )}
    </main>
  );
}

/* ===================== HOME ===================== */

function HomeScreen({
  onSubmit,
  isLoading,
  selectedPlatforms,
  defaultPlatforms,
  onSelectedPlatformsChange,
  onSaveDefaultPlatforms,
  useLocation,
  weather,
  weatherLoading,
  onToggleLocation,
  isGuest,
  showLoginNudge,
  onDismissLoginNudge,
}: {
  onSubmit: (text: string) => void;
  isLoading: boolean;
  selectedPlatforms: Platform[];
  defaultPlatforms: Platform[];
  onSelectedPlatformsChange: (p: Platform[]) => void;
  onSaveDefaultPlatforms: (p: Platform[]) => Promise<void>;
  useLocation: boolean;
  weather: WeatherSnapshot | null;
  weatherLoading: boolean;
  onToggleLocation: (v: boolean) => void;
  isGuest: boolean;
  showLoginNudge: boolean;
  onDismissLoginNudge: () => void;
}) {
  const [text, setText] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Sugerencias contextuales (momento + clima) y recientes desde localStorage.
  const suggestions = useMemo(
    () => getContextualSuggestions(inferContext(), weather, 4),
    [weather],
  );
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());
  const [watchlist] = useState<string[]>(() => readWatchlist());

  const handleSubmit = () => {
    if (text.trim().length >= 2) onSubmit(text.trim());
  };

  const togglePlatform = (p: Platform) => {
    const has = selectedPlatforms.includes(p);
    onSelectedPlatformsChange(has ? selectedPlatforms.filter((x) => x !== p) : [...selectedPlatforms, p]);
  };

  return (
    <section className="relative flex min-h-[calc(100vh-49px)] flex-col items-center justify-center overflow-hidden px-6 pb-40 pt-12 animate-fade-in">
      {/* Subtle ambient gradient — barely perceptible */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/4 rounded-full"
          style={{ background: "radial-gradient(circle, oklch(0.50 0.22 277 / 0.04) 0%, transparent 70%)" }}
        />
      </div>

      {/* Login nudge */}
      {showLoginNudge && (
        <div className="absolute top-4 left-1/2 z-20 w-full max-w-sm -translate-x-1/2 px-4 animate-fade-in">
          <div className="overflow-hidden rounded-2xl bg-white shadow-float">
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="text-[13px] font-semibold text-foreground">Guardá tu perfil</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Creá tu cuenta para guardar plataformas y preferencias.
                </p>
                <div className="mt-3 flex gap-2">
                  <Link to="/login" className="inline-flex rounded-full bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-80">
                    Crear cuenta
                  </Link>
                  <button onClick={onDismissLoginNudge} className="text-[11px] text-muted-foreground hover:text-foreground">Ahora no</button>
                </div>
              </div>
              <button onClick={onDismissLoginNudge} className="text-muted-foreground/50 transition-colors hover:text-foreground">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Center content */}
      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        {/* Orb + orbiting platform logos */}
        <div className="relative flex h-[300px] w-full items-center justify-center">
          <PlatformOrbit />
          <div className="relative z-10">
            <VoiceOrb
              onFinalTranscript={(t) => { setLiveTranscript(""); onSubmit(t); }}
              onTranscriptChange={setLiveTranscript}
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Headline */}
        <h1 className="mt-2 font-serif text-[2.6rem] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-5xl">
          ¿Qué querés<br />ver hoy?
        </h1>

        <p className="mt-4 min-h-[2.5rem] text-[13px] text-muted-foreground">
          {liveTranscript ? (
            <span className="italic text-foreground/80">{liveTranscript}</span>
          ) : isLoading ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Buscando en todas tus plataformas…
            </span>
          ) : (
            "Describilo con tus palabras. Te encontramos lo perfecto en todas tus plataformas."
          )}
        </p>

        {/* Input — Apple search bar style */}
        <div className="mt-7 w-full">
          <div className={cn(
            "flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-card transition-all duration-200",
            "focus-within:shadow-float",
          )}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="una de acción, algo para llorar, comedia italiana…"
              disabled={isLoading}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/35 focus:outline-none disabled:opacity-50"
            />
            <MicButton
              size="sm"
              onTranscript={(t, isFinal) => {
                if (!t || !isFinal) return;
                setText((prev) => (prev ? `${prev.trim()} ${t}` : t));
                inputRef.current?.focus();
              }}
              className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={text.trim().length < 2 || isLoading}
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all",
                text.trim().length >= 2 && !isLoading
                  ? "bg-foreground text-background hover:opacity-80"
                  : "bg-muted text-muted-foreground/30 cursor-not-allowed",
              )}
              aria-label="Buscar"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Platform filter — minimal chips */}
        <div className="mt-4 w-full">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 flex-wrap gap-1.5">
              {(PLATFORM_OPTIONS as Platform[]).map((p) => {
                const active = selectedPlatforms.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    style={active ? { color: colorForPlatform(p) } : undefined}
                    className={cn(
                      "inline-flex min-h-[24px] items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-all",
                      active
                        ? "bg-white shadow-xs"
                        : "text-muted-foreground/40 hover:text-muted-foreground/70",
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForPlatform(p) }} />
                    {p}
                  </button>
                );
              })}
              {selectedPlatforms.length > 0 &&
                JSON.stringify([...selectedPlatforms].sort()) !== JSON.stringify([...defaultPlatforms].sort()) && (
                  <button onClick={() => onSaveDefaultPlatforms(selectedPlatforms)} className="text-[11px] text-primary/70 hover:text-primary">
                    Guardar
                  </button>
                )}
            </div>
            <button
              type="button"
              title={useLocation ? (weather ? weatherHintShort(weather) : "Usando ubicación") : "Activar ubicación"}
              onClick={() => onToggleLocation(!useLocation)}
              className={cn("shrink-0 p-1 transition-all", useLocation ? "text-primary" : "text-muted-foreground/30 hover:text-muted-foreground/60")}
            >
              {weatherLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
            </button>
          </div>
        </div>

        {/* Sugerencias contextuales — tarjetas tap-to-search */}
        {suggestions.length > 0 && (
          <div className="mt-7 w-full">
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => onSubmit(s.query)}
                  disabled={isLoading}
                  className="rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[12px] font-medium text-foreground/75 shadow-xs transition-all hover:text-foreground hover:shadow-card disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tus últimas búsquedas — reclickeables */}
        {recent.length > 0 && (
          <div className="mt-6 w-full text-left">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                Tus últimas búsquedas
              </span>
              <button
                onClick={() => { clearRecentSearches(); setRecent([]); }}
                className="text-[10px] text-muted-foreground/40 transition-colors hover:text-foreground"
              >
                Limpiar
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((q) => (
                <button
                  key={q}
                  onClick={() => onSubmit(q)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1 rounded-full bg-black/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground/80 transition-colors hover:bg-black/[0.06] hover:text-foreground disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3 opacity-50" />
                  <span className="max-w-[160px] truncate">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tu lista para ver — watchlist guardada */}
        {watchlist.length > 0 && (
          <div className="mt-5 w-full text-left">
            <div className="mb-2 px-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                Tu lista para ver
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {watchlist.slice(0, 8).map((title) => (
                <button
                  key={title}
                  onClick={() => onSubmit(`contame más sobre ${title} y algo parecido`)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1 rounded-full bg-black/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground/80 transition-colors hover:bg-black/[0.06] hover:text-foreground disabled:opacity-50"
                >
                  <Bookmark className="h-3 w-3 opacity-50" />
                  <span className="max-w-[160px] truncate">{title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Poster marquee — mood board at bottom, very subtle */}
      <div className="absolute bottom-0 left-0 right-0 z-0 opacity-40">
        <PosterMarquee />
      </div>
    </section>
  );
}

/* ===================== CHAT ===================== */

function ChatScreen({
  messages,
  isLoading,
  isGuest,
  session,
  posters,
  onSubmit,
  onFeedback,
  onNewSearch,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  isGuest: boolean;
  session: Session | null;
  posters: Record<string, string | null>;
  onSubmit: (text: string) => void;
  onFeedback: (msgId: string, title: string, platform: string, sentiment: FeedbackSentiment) => void;
  onNewSearch: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [deckMode, setDeckMode] = useState(true);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [socialMode, setSocialMode] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [socialMatch, setSocialMatch] = useState<SocialMatchRow | null>(null);

  const lastAsstMsgId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  // Supabase Realtime: listen for incoming social matches where I'm user_b
  useEffect(() => {
    if (!socialMode || !session) return;
    const channel = supabase
      .channel("social_matches_incoming")
      .on(
        "postgres_changes" as Parameters<ReturnType<typeof supabase.channel>["on"]>[0],
        {
          event: "INSERT",
          schema: "public",
          table: "social_matches",
          filter: `user_b=eq.${session.user.id}`,
        },
        async (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
          // Fetch the other person's presence info
          const { data: presence } = await supabase
            .from("user_presence")
            .select("display_name, avatar_color")
            .eq("user_id", row.user_a as string)
            .single();
          setSocialMatch({
            ...(row as unknown as SocialMatchRow),
            other_display_name: presence?.display_name ?? "Alguien",
            other_avatar_color: presence?.avatar_color ?? "#6366f1",
          });
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [socialMode, session]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Wrap onFeedback to trigger social match check on likes
  const handleFeedbackWithSocial = async (
    msgId: string,
    title: string,
    platform: string,
    sentiment: FeedbackSentiment,
  ) => {
    onFeedback(msgId, title, platform, sentiment);
    if (sentiment === "like" && socialMode && userLocation) {
      try {
        const match = await findNearbyMatch({
          data: { title, platform, lat: userLocation.lat, lng: userLocation.lng },
        });
        if (match) setSocialMatch(match);
      } catch { /* noop — social is best-effort */ }
    }
  };

  return (
    <section className="mx-auto flex max-w-2xl flex-col px-4 pb-8 pt-6 sm:px-6 animate-fade-in">
      {/* Social match overlay */}
      {socialMatch && (
        <SocialMatchOverlay
          match={socialMatch}
          poster={posters[socialMatch.title] ?? null}
          onClose={() => setSocialMatch(null)}
        />
      )}

      {/* Chat window */}
      <div className="overflow-hidden rounded-3xl bg-white shadow-float">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/[0.05] px-6 py-4">
          <span className="text-[13px] font-semibold tracking-tight text-foreground">Cinéfilo</span>
          <button
            onClick={onNewSearch}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-muted-foreground/60 transition-all hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            Nueva búsqueda
          </button>
        </div>

        {/* Messages */}
        <div className="max-h-[62vh] overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <UserBubble key={msg.id} text={msg.text} />
              ) : (
                <AssistantBubble
                  key={msg.id}
                  msg={msg}
                  isGuest={isGuest}
                  posters={posters}
                  isLatest={msg.id === lastAsstMsgId}
                  deckMode={deckMode}
                  onViewAsList={() => setDeckMode(false)}
                  onFeedback={(title, platform, sentiment) =>
                    handleFeedbackWithSocial(msg.id, title, platform, sentiment)}
                />
              ),
            )}

            {isLoading && (
              <div className="flex items-center gap-2 animate-fade-in">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 [animation:bounce_1.2s_ease-in-out_0s_infinite]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 [animation:bounce_1.2s_ease-in-out_0.2s_infinite]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 [animation:bounce_1.2s_ease-in-out_0.4s_infinite]" />
                </div>
              </div>
            )}
          </div>
          <div ref={endRef} />
        </div>
      </div>

      {/* Voice-only refinement */}
      <div className="mt-6 flex flex-col items-center gap-2">
        {liveTranscript ? (
          <p className="text-center text-[13px] italic text-foreground/70 animate-fade-in">{liveTranscript}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground/40">
            {isLoading ? "Buscando…" : "Hablá para refinar tu búsqueda"}
          </p>
        )}
        <MicButton
          size="md"
          onTranscript={(t, isFinal) => {
            if (!t) { setLiveTranscript(""); return; }
            if (isFinal) {
              setLiveTranscript("");
              onSubmit(t.trim());
            } else {
              setLiveTranscript(t);
            }
          }}
        />
      </div>

      {/* Social mode toggle — only for logged-in users */}
      {!isGuest && (
        <div className="mt-3 flex justify-center">
          <SocialModeToggle
            active={socialMode}
            onActivate={(loc) => { setSocialMode(true); setUserLocation(loc); }}
            onDeactivate={() => { setSocialMode(false); setUserLocation(null); }}
          />
        </div>
      )}

      {isGuest && (
        <p className="mt-4 text-center text-[11px] text-muted-foreground/60">
          ¿Querés que recuerde tus gustos?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Crear cuenta gratis →
          </Link>
        </p>
      )}
    </section>
  );
}

/* ===================== BUBBLES ===================== */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-[20px] rounded-tr-md bg-foreground px-4 py-2.5">
        <p className="text-[13px] leading-relaxed text-white">{text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({
  msg,
  isGuest,
  posters,
  isLatest,
  deckMode,
  onViewAsList,
  onFeedback,
}: {
  msg: ChatMessage;
  isGuest: boolean;
  posters: Record<string, string | null>;
  isLatest: boolean;
  deckMode: boolean;
  onViewAsList: () => void;
  onFeedback: (title: string, platform: string, sentiment: FeedbackSentiment) => void;
}) {
  const { data } = msg;
  if (!data) return null;
  const { main, alternatives } = data;

  // Compact pastilla for previous turns
  if (!isLatest) {
    const likedTitles = Object.entries(msg.feedbackGiven ?? {})
      .filter(([, s]) => s === "love" || s === "like")
      .map(([title]) => title);
    const total = 1 + alternatives.length;
    return (
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-[4px] bg-white/60 px-3 py-2 text-[11px] text-muted-foreground/70 shadow-xs max-w-[92%]">
        <span>Viste {total} {total === 1 ? "título" : "títulos"}</span>
        {likedTitles.length > 0 && (
          <>
            <span>·</span>
            <span className="text-pink-500">❤️ {likedTitles.join(", ")}</span>
          </>
        )}
      </div>
    );
  }

  // Swipe deck for latest response
  if (deckMode && msg.deckItems) {
    return (
      <SwipeCardDeck
        items={msg.deckItems}
        posters={posters}
        onSwipe={(item, direction) =>
          onFeedback(item.rec.title, item.rec.platform, direction === "like" ? "like" : "dislike")
        }
        onWatchlist={(item) => onFeedback(item.rec.title, item.rec.platform, "watchlist")}
        onViewAsList={onViewAsList}
      />
    );
  }

  // List mode (fallback / "Ver como lista")
  const mainFeedback = msg.feedbackGiven?.[main.title] ?? null;
  const mainPoster = posters[main.title];

  return (
    <div className="flex flex-col gap-3">
      {/* Main recommendation card */}
      <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-tl-[4px] bg-white shadow-card">
        <div className="flex">
          <div
            className="relative h-[172px] w-[115px] shrink-0 overflow-hidden"
            style={!mainPoster ? { background: `${colorForPlatform(main.platform)}12` } : undefined}
          >
            {mainPoster ? (
              <img src={mainPoster} alt={main.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-3xl font-black opacity-[0.12]" style={{ color: colorForPlatform(main.platform) }}>
                  {main.title.charAt(0)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col justify-between p-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: `${colorForPlatform(main.platform)}14` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForPlatform(main.platform) }} />
                <span className="text-[10px] font-semibold" style={{ color: colorForPlatform(main.platform) }}>
                  {main.platform}
                </span>
              </div>
              <h3 className="text-[14px] font-bold leading-tight tracking-tight text-foreground">{main.title}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{main.duration} · {main.type}</p>
              <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-foreground/60">{main.reason}</p>
            </div>
            <a
              href={deepLinkFor(main.platform, main.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex w-fit items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: colorForPlatform(main.platform) }}
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Ver en {main.platform}
            </a>
          </div>
        </div>

        {!isGuest && (
          <div className="border-t border-black/[0.04] px-3 py-2">
            <FeedbackRow
              feedback={mainFeedback}
              onLove={() => onFeedback(main.title, main.platform, "love")}
              onLike={() => onFeedback(main.title, main.platform, "like")}
              onWatchlist={() => onFeedback(main.title, main.platform, "watchlist")}
              onSeen={() => onFeedback(main.title, main.platform, "seen")}
              onDislike={() => onFeedback(main.title, main.platform, "dislike")}
            />
          </div>
        )}
      </div>

      {alternatives.length > 0 && (
        <div className="max-w-[92%]">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">También podría ser</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {alternatives.map((alt) => {
              const altPoster = posters[alt.title];
              const altFeedback = msg.feedbackGiven?.[alt.title] ?? null;
              return (
                <div key={alt.title} className="flex-none w-[124px] overflow-hidden rounded-xl bg-white shadow-card">
                  <div className="h-[78px] overflow-hidden" style={!altPoster ? { background: `${colorForPlatform(alt.platform)}10` } : undefined}>
                    {altPoster ? (
                      <img src={altPoster} alt={alt.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <span className="text-sm font-black opacity-[0.12]" style={{ color: colorForPlatform(alt.platform) }}>
                          {alt.title.charAt(0)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 text-[11px] font-semibold leading-tight tracking-tight text-foreground">{alt.title}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForPlatform(alt.platform) }} />
                      <span className="text-[10px] text-muted-foreground/60">{alt.platform}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <a href={deepLinkFor(alt.platform, alt.title)} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground">
                        Ver →
                      </a>
                      {!isGuest && (
                        <CompactFeedback
                          feedback={altFeedback}
                          onWatchlist={() => onFeedback(alt.title, alt.platform, "watchlist")}
                          onSeen={() => onFeedback(alt.title, alt.platform, "seen")}
                          onDislike={() => onFeedback(alt.title, alt.platform, "dislike")}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== FEEDBACK ===================== */

const FEEDBACK_ACTIONS = [
  { key: "love",      label: "Me encanta",       Icon: Heart,      active: "text-pink-500",       hover: "hover:bg-pink-50 hover:text-pink-500" },
  { key: "like",      label: "Me gusta",          Icon: ThumbsUp,   active: "text-primary",        hover: "hover:bg-primary/8 hover:text-primary" },
  { key: "watchlist", label: "Ver en otro momento", Icon: Bookmark, active: "text-amber-500",      hover: "hover:bg-amber-50 hover:text-amber-500" },
  { key: "seen",      label: "Ya la vi",          Icon: Eye,        active: "text-muted-foreground", hover: "hover:bg-muted hover:text-foreground" },
  { key: "dislike",   label: "No me gusta",       Icon: ThumbsDown, active: "text-destructive",    hover: "hover:bg-destructive/8 hover:text-destructive" },
] as const;

function FeedbackRow({ feedback, onLove, onLike, onWatchlist, onSeen, onDislike }: {
  feedback: FeedbackSentiment | null;
  onLove: () => void; onLike: () => void; onWatchlist: () => void; onSeen: () => void; onDislike: () => void;
}) {
  const handlers: Record<string, () => void> = { love: onLove, like: onLike, watchlist: onWatchlist, seen: onSeen, dislike: onDislike };

  if (feedback) {
    const match = FEEDBACK_ACTIONS.find((a) => a.key === feedback);
    if (match) {
      const { Icon, label, active } = match;
      return (
        <div className={cn("flex items-center gap-1.5 text-xs font-medium", active)}>
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
      );
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      {FEEDBACK_ACTIONS.map(({ key, label, Icon, hover }) => (
        <button
          key={key}
          onClick={handlers[key]}
          title={label}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-muted-foreground/60 transition-colors",
            hover,
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="text-[9px] leading-none">{label.split(" ")[0]}</span>
        </button>
      ))}
    </div>
  );
}

function CompactFeedback({ feedback, onWatchlist, onSeen, onDislike }: {
  feedback: FeedbackSentiment | null;
  onWatchlist: () => void; onSeen: () => void; onDislike: () => void;
}) {
  if (feedback) {
    const match = FEEDBACK_ACTIONS.find((a) => a.key === feedback);
    return <span className={cn("text-[10px]", match?.active ?? "text-muted-foreground")}>{
      feedback === "like" || feedback === "love" || feedback === "watchlist" ? "✓" : "✗"
    }</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <button onClick={onWatchlist} title="Ver en otro momento" className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-amber-50 hover:text-amber-500">
        <Bookmark className="h-3 w-3" />
      </button>
      <button onClick={onSeen} title="Ya la vi" className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground">
        <Eye className="h-3 w-3" />
      </button>
      <button onClick={onDislike} title="No me gusta" className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
        <ThumbsDown className="h-3 w-3" />
      </button>
    </div>
  );
}
