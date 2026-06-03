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
  X,
  Youtube,
} from "lucide-react";
import { SwipeCardDeck } from "@/components/SwipeCardDeck";
import type { SwipeItem } from "@/components/SwipeCardDeck";
import { SocialModeToggle } from "@/components/SocialModeToggle";
import { SocialMatchOverlay } from "@/components/SocialMatchOverlay";
import { NearbyUsersStrip } from "@/components/NearbyUsersStrip";
import { findNearbyMatch, updatePresenceMood } from "@/lib/social.functions";
import type { SocialMatchRow, MoodFilters } from "@/lib/social.functions";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  PLATFORM_OPTIONS,
  colorForPlatform,
  deepLinkFor,
  type Platform,
  type RecommendationsResult,
} from "@/lib/recommendations";
import { recommendConversational, chooseFromLiked } from "@/lib/recommendations.functions";
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
  isChooseMode?: boolean;
  finalItem?: SwipeItem;
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
  const [isChooseMode, setIsChooseMode] = useState(false);
  const [chooseLikedItems, setChooseLikedItems] = useState<SwipeItem[]>([]);
  const [chooseHistory, setChooseHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
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
      setIsChooseMode(false);
      setChooseLikedItems([]);
      setChooseHistory([]);
    };
    window.addEventListener("que-veo:go-home", handler);
    return () => window.removeEventListener("que-veo:go-home", handler);
  }, []);

  const submitChooseMode = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;

    const userMsg: ChatMessage = { id: uid(), role: "user", text: trimmed, isChooseMode: true };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    const newHistory = [...chooseHistory, { role: "user" as const, content: trimmed }];
    const titles = chooseLikedItems.map((i) => i.rec.title);

    try {
      const result = await chooseFromLiked({
        data: { likedTitles: titles, messages: newHistory },
      });
      const finalItem = result.finalTitle
        ? chooseLikedItems.find((i) => i.rec.title === result.finalTitle) ?? null
        : null;
      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: result.text,
        isChooseMode: true,
        ...(finalItem ? { finalItem } : {}),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setChooseHistory([...newHistory, { role: "assistant", content: result.text }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Algo salió mal.";
      toast.error(msg, { duration: 6000 });
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAskForHelp = async (liked: SwipeItem[]) => {
    const titles = liked.map((i) => i.rec.title);
    setIsChooseMode(true);
    setChooseLikedItems(liked);

    const userText = `Elegí estas opciones: ${titles.join(", ")}. Ayudame a decidir cuál ver hoy.`;
    const userMsg: ChatMessage = { id: uid(), role: "user", text: userText, isChooseMode: true };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    const initHistory = [{ role: "user" as const, content: userText }];

    try {
      const result = await chooseFromLiked({
        data: { likedTitles: titles, messages: initHistory },
      });
      const finalItem = result.finalTitle
        ? liked.find((i) => i.rec.title === result.finalTitle) ?? null
        : null;
      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: result.text,
        isChooseMode: true,
        ...(finalItem ? { finalItem } : {}),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setChooseHistory([...initHistory, { role: "assistant", content: result.text }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Algo salió mal.";
      toast.error(msg, { duration: 6000 });
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    } finally {
      setIsLoading(false);
    }
  };

  const submit = async (text: string) => {
    if (isChooseMode) { await submitChooseMode(text); return; }
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
          onAskForHelp={handleAskForHelp}
          onNewSearch={() => {
            setStep("home");
            setMessages([]);
            setInputText("");
            setExcluded([]);
            setPosters({});
            setIsChooseMode(false);
            setChooseLikedItems([]);
            setChooseHistory([]);
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
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(
    () => getContextualSuggestions(inferContext(), weather, 5),
    [weather],
  );
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());

  const showDropdown = focused && (recent.length > 0 || suggestions.length > 0) && !text;

  const handleSubmit = () => {
    if (text.trim().length >= 2) { setFocused(false); onSubmit(text.trim()); }
  };

  const pick = (q: string) => { setFocused(false); onSubmit(q); };

  const togglePlatform = (p: Platform) => {
    const has = selectedPlatforms.includes(p);
    onSelectedPlatformsChange(has ? selectedPlatforms.filter((x) => x !== p) : [...selectedPlatforms, p]);
  };

  return (
    <section className="relative flex min-h-[calc(100vh-49px)] flex-col items-center justify-center overflow-hidden px-5 animate-fade-in">

      {/* Cinematic poster strip — decorative scrolling background */}
      <PosterMarquee background />

      {/* Login nudge */}
      {showLoginNudge && (
        <div className="absolute top-4 left-1/2 z-20 w-full max-w-sm -translate-x-1/2 px-4 animate-fade-in">
          <div className="overflow-hidden rounded-2xl bg-white shadow-float">
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="text-[13px] font-semibold text-foreground">Guardá tu perfil</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Creá tu cuenta para guardar plataformas y preferencias.</p>
                <div className="mt-3 flex gap-2">
                  <Link to="/login" className="inline-flex rounded-full bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-80">Crear cuenta</Link>
                  <button onClick={onDismissLoginNudge} className="text-[11px] text-muted-foreground hover:text-foreground">Ahora no</button>
                </div>
              </div>
              <button onClick={onDismissLoginNudge} className="text-muted-foreground/50 hover:text-foreground">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Center content — frosted glass panel */}
      <div className="relative z-10 w-full max-w-lg rounded-3xl bg-background/80 px-8 py-8 shadow-float backdrop-blur-md ring-1 ring-black/[0.05]">

        {/* Tagline */}
        <div className="mb-6 text-center">
          <p className="text-[21px] font-bold tracking-tight text-foreground">
            Describí lo que querés ver y te recomendamos qué mirar hoy.
          </p>
        </div>

        {/* Search bar + dropdown wrapper */}
        <div className="relative">
          {/* Main search bar */}
          <div className={cn(
            "flex items-center gap-3 rounded-2xl bg-white px-5 shadow-card transition-all duration-200",
            focused ? "shadow-float" : "",
            isLoading && "opacity-70 pointer-events-none",
          )}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="una de acción, algo para llorar, comedia italiana…"
              disabled={isLoading}
              className="min-h-[58px] min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
            />
            {isLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground/40" />
            ) : (
              <>
                <MicButton
                  size="sm"
                  onTranscript={(t, isFinal) => {
                    if (!t) return;
                    if (isFinal) { setFocused(false); onSubmit(t.trim()); }
                    else setText(t);
                  }}
                  className="shrink-0 text-muted-foreground/40 hover:text-primary"
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={text.trim().length < 2}
                  className={cn(
                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
                    text.trim().length >= 2
                      ? "bg-foreground text-background hover:opacity-80"
                      : "bg-muted text-muted-foreground/20",
                  )}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>

          {/* Dropdown — recientes + sugerencias */}
          {showDropdown && (
            <div
              ref={dropdownRef}
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-2xl bg-white shadow-float animate-fade-in"
            >
              {recent.length > 0 && (
                <div className="px-4 pt-3 pb-1">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Recientes</span>
                    <button onClick={() => { clearRecentSearches(); setRecent([]); }} className="text-[10px] text-muted-foreground/50 hover:text-foreground">Limpiar</button>
                  </div>
                  {recent.slice(0, 4).map((q) => (
                    <button key={q} onMouseDown={() => pick(q)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.04]">
                      <RotateCcw className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <span className="truncate">{q}</span>
                    </button>
                  ))}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className={cn("px-4 pb-3", recent.length > 0 && "pt-1 border-t border-black/[0.04]")}>
                  {recent.length === 0 && <div className="mb-1.5 pt-3"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Sugerencias</span></div>}
                  {suggestions.map((s) => (
                    <button key={s.label} onMouseDown={() => pick(s.query)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.04]">
                      <span className="text-base leading-none">{s.label.split(" ")[0]}</span>
                      <span className="truncate">{s.label.split(" ").slice(1).join(" ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Platform filter */}
        <div className="mt-4 px-1">
          <p className="mb-2 text-[13px] text-muted-foreground/75">Elegí tus plataformas favoritas</p>
          <div className="flex flex-wrap gap-1.5">
            {(PLATFORM_OPTIONS as Platform[]).map((p) => {
              const active = selectedPlatforms.includes(p);
              return (
                <button key={p} onClick={() => togglePlatform(p)}
                  style={active ? { color: colorForPlatform(p) } : undefined}
                  className={cn(
                    "inline-flex min-h-[24px] items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-all",
                    active ? "bg-white shadow-xs" : "text-muted-foreground/55 hover:text-muted-foreground/80",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForPlatform(p) }} />
                  {p}
                </button>
              );
            })}
            {selectedPlatforms.length > 0 &&
              JSON.stringify([...selectedPlatforms].sort()) !== JSON.stringify([...defaultPlatforms].sort()) && (
                <button onClick={() => onSaveDefaultPlatforms(selectedPlatforms)} className="text-[11px] text-primary/70 hover:text-primary">Guardar</button>
              )}
          </div>

          {/* Location toggle — compact, bottom-right */}
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onToggleLocation(!useLocation)}
              className={cn(
                "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
                useLocation ? "bg-primary" : "bg-muted-foreground/20",
              )}
              role="switch"
              aria-checked={useLocation}
            >
              <span className={cn(
                "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-xs transition-transform duration-200",
                useLocation ? "translate-x-3" : "translate-x-0",
              )} />
            </button>
            <span className="text-[10px] text-muted-foreground/45">
              {useLocation
                ? (weatherLoading ? "Obteniendo clima…" : weather ? weatherHintShort(weather) : "Ubicación activa")
                : "Activar ubicación"}
            </span>
            <span className="group relative cursor-default">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/30 text-[8px] font-bold leading-none text-muted-foreground/30 hover:border-muted-foreground/60 hover:text-muted-foreground/60">?</span>
              <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden w-52 rounded-xl bg-foreground px-3 py-2 text-[11px] leading-snug text-background shadow-float group-hover:block">
                Usamos tu ubicación solo para mejorar las recomendaciones con el clima y la hora local. No la guardamos ni la compartimos.
              </span>
            </span>
          </div>
        </div>
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
  onAskForHelp,
  onNewSearch,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  isGuest: boolean;
  session: Session | null;
  posters: Record<string, string | null>;
  onSubmit: (text: string) => void;
  onFeedback: (msgId: string, title: string, platform: string, sentiment: FeedbackSentiment) => void;
  onAskForHelp: (liked: SwipeItem[]) => void;
  onNewSearch: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [deckMode, setDeckMode] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [socialMode, setSocialMode] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [socialMatch, setSocialMatch] = useState<SocialMatchRow | null>(null);
  const [moodBannerDismissed, setMoodBannerDismissed] = useState(false);
  const [socialPromptOpen, setSocialPromptOpen] = useState(false);
  const prevMoodKeyRef = useRef<string>("");
  const [swipeLiked, setSwipeLiked] = useState<SwipeItem[]>([]);

  const handleSwipeLike = (item: SwipeItem) => {
    setSwipeLiked((prev) => [...prev, item]);
  };

  const handleNewSearch = () => {
    setSwipeLiked([]);
    onNewSearch();
  };

  // Extract mood filters from the latest assistant message
  const activeMoodFilters = useMemo((): MoodFilters | null => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last?.data?.filters) return null;
    const f = last.data.filters;
    if (!f.mood && !f.company && !f.attention && !f.type) return null;
    return { mood: f.mood ?? null, company: f.company ?? null, attention: f.attention ?? null, type: f.type ?? null };
  }, [messages]);

  // Reset banner when mood changes (new search)
  useEffect(() => {
    const key = `${activeMoodFilters?.mood}|${activeMoodFilters?.company}`;
    if (key !== prevMoodKeyRef.current) {
      prevMoodKeyRef.current = key;
      setMoodBannerDismissed(false);
    }
  }, [activeMoodFilters]);

  // When social mode is active and mood changes, re-upsert presence with updated mood
  const prevMoodRef = useRef<MoodFilters | null>(null);
  useEffect(() => {
    if (!socialMode || !userLocation || !activeMoodFilters) return;
    const prev = prevMoodRef.current;
    const changed = !prev ||
      prev.mood !== activeMoodFilters.mood ||
      prev.company !== activeMoodFilters.company ||
      prev.attention !== activeMoodFilters.attention;
    if (!changed) return;
    prevMoodRef.current = activeMoodFilters;
    void updatePresenceMood({
      data: {
        moodFilter: activeMoodFilters.mood,
        companyFilter: activeMoodFilters.company,
        attentionFilter: activeMoodFilters.attention,
        typeFilter: activeMoodFilters.type,
      },
    }).catch(() => {});
  }, [socialMode, userLocation, activeMoodFilters]);

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
          data: { title, platform, lat: userLocation.lat, lng: userLocation.lng, moodFilters: activeMoodFilters ?? undefined },
        });
        if (match) setSocialMatch(match);
      } catch { /* noop — social is best-effort */ }
    }
  };

  return (
    <section className="relative mx-auto flex max-w-2xl flex-col px-4 pb-8 pt-6 sm:px-6 animate-fade-in">
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
          <span className="text-[21px] font-semibold tracking-tight text-foreground">Cinéfilo</span>
          <button
            onClick={handleNewSearch}
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
                  onLike={handleSwipeLike}
                  onAskForHelp={onAskForHelp}
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

      {/* Liked pile — floats to the right of the chat window on lg screens */}
      {swipeLiked.length > 0 && (
        <div
          className="absolute right-0 top-6 hidden translate-x-[calc(100%+20px)] lg:block"
          style={{ animation: "slide-up-fade 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          <FloatingLikedPile items={swipeLiked} posters={posters} />
        </div>
      )}

      {/* Chat input bar */}
      <div className="mt-4">
        <div className={cn(
          "flex items-center gap-3 rounded-2xl bg-white px-4 shadow-card transition-all duration-200",
          isLoading && "opacity-60 pointer-events-none",
        )}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && chatInput.trim().length >= 2) {
                onSubmit(chatInput.trim());
                setChatInput("");
              }
            }}
            placeholder={isLoading ? "Buscando…" : "Refiná o hacé una nueva búsqueda…"}
            disabled={isLoading}
            className="min-h-[52px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/35 focus:outline-none"
          />
          <MicButton
            size="sm"
            onTranscript={(t, isFinal) => {
              if (!t) { setChatInput(""); return; }
              if (isFinal) { onSubmit(t.trim()); setChatInput(""); }
              else setChatInput(t);
            }}
            className="shrink-0 text-muted-foreground/40 hover:text-primary"
          />
          <button
            type="button"
            onClick={() => { if (chatInput.trim().length >= 2) { onSubmit(chatInput.trim()); setChatInput(""); } }}
            disabled={chatInput.trim().length < 2 || isLoading}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
              chatInput.trim().length >= 2
                ? "bg-foreground text-background hover:opacity-80"
                : "bg-muted text-muted-foreground/20",
            )}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mood match banner — show when there's a specific mood detected and social is off */}
      {!isGuest && !socialMode && !moodBannerDismissed && activeMoodFilters && (
        <MoodMatchBanner
          moodFilters={activeMoodFilters}
          onActivate={() => { setMoodBannerDismissed(true); setSocialPromptOpen(true); }}
          onDismiss={() => setMoodBannerDismissed(true)}
        />
      )}

      {/* Social mode toggle — only for logged-in users */}
      {!isGuest && (
        <div className="mt-3 flex justify-center">
          <SocialModeToggle
            active={socialMode}
            moodFilters={activeMoodFilters}
            forcePrompt={socialPromptOpen}
            onPromptShown={() => setSocialPromptOpen(false)}
            onActivate={(loc) => { setSocialMode(true); setUserLocation(loc); }}
            onDeactivate={() => { setSocialMode(false); setUserLocation(null); prevMoodRef.current = null; }}
          />
        </div>
      )}

      {/* Nearby users strip — visible when social mode is active */}
      {socialMode && userLocation && (
        <NearbyUsersStrip
          location={userLocation}
          activeMoodFilters={activeMoodFilters}
        />
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
  onLike,
  onAskForHelp,
}: {
  msg: ChatMessage;
  isGuest: boolean;
  posters: Record<string, string | null>;
  isLatest: boolean;
  deckMode: boolean;
  onViewAsList: () => void;
  onFeedback: (title: string, platform: string, sentiment: FeedbackSentiment) => void;
  onLike?: (item: SwipeItem) => void;
  onAskForHelp?: (liked: SwipeItem[]) => void;
}) {
  const { data } = msg;

  // Choose mode: final pick card or conversational text bubble
  if (!data) {
    if (msg.finalItem) {
      return (
        <div className="flex flex-col gap-3 max-w-[92%]">
          {msg.text && (
            <div className="rounded-[20px] rounded-tl-[4px] bg-white px-4 py-3 shadow-xs">
              <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">{msg.text}</p>
            </div>
          )}
          <FinalPickCard item={msg.finalItem} poster={posters[msg.finalItem.rec.title] ?? null} />
        </div>
      );
    }
    if (msg.text) {
      return (
        <div className="flex items-end gap-2 max-w-[85%]">
          <div className="rounded-[20px] rounded-tl-[4px] bg-white px-4 py-3 shadow-xs">
            <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">{msg.text}</p>
          </div>
        </div>
      );
    }
    return null;
  }

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
        onViewAsList={onViewAsList}
        onLike={onLike}
        onAskForHelp={onAskForHelp}
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

/* ===================== MOOD MATCH BANNER ===================== */

function moodLabel(f: MoodFilters): string {
  const parts: string[] = [];
  if (f.company === "Solo") parts.push("noche en solitario");
  else if (f.company === "En pareja") parts.push("plan para dos");
  else if (f.company === "Familia con niños") parts.push("noche en familia");
  else if (f.company === "Con amigos") parts.push("plan con amigos");
  if (f.mood === "Algo liviano" || f.mood === "Comedia") parts.push("algo liviano");
  else if (f.mood === "Épico para relajar") parts.push("modo relajado");
  else if (f.mood === "Drama") parts.push("drama");
  else if (f.mood === "Suspenso") parts.push("suspenso");
  if (f.attention === "De fondo" || f.attention === "Comfort watch") parts.push("de fondo");
  return parts.length > 0 ? parts.join(" · ") : "mood específico";
}

function MoodMatchBanner({
  moodFilters,
  onActivate,
  onDismiss,
}: {
  moodFilters: MoodFilters;
  onActivate: () => void;
  onDismiss: () => void;
}) {
  const label = moodLabel(moodFilters);
  return (
    <div className="mt-4 w-full max-w-sm mx-auto animate-fade-in">
      <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
        <span className="mt-0.5 text-base">💜</span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-foreground leading-snug">
            ¿Alguien cerca está en el mismo plan?
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">{label}</p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onActivate}
            className="rounded-xl bg-foreground px-3 py-1 text-[11px] font-semibold text-background"
          >
            Activar
          </button>
          <button
            onClick={onDismiss}
            className="text-center text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
          >
            No, gracias
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── FloatingLikedPile ─────────────────────────────────────────────────────── */

function FloatingLikedPile({
  items,
  posters,
}: {
  items: SwipeItem[];
  posters: Record<string, string | null>;
}) {
  const [detailItem, setDetailItem] = useState<SwipeItem | null>(null);

  return (
    <>
      <div className="flex w-[232px] flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Guardadas
          </p>
          <span className="rounded-full bg-pink-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
            ♥ {items.length}
          </span>
        </div>
        {/* 2-column grid, cards wrap left→right */}
        <div className="flex max-h-[70vh] flex-wrap gap-2 overflow-y-auto scrollbar-none">
          {items.map((item, i) => (
            <LikedThumbnail
              key={item.rec.title}
              item={item}
              poster={posters[item.rec.title] ?? null}
              isNew={i === items.length - 1}
              onDetail={() => setDetailItem(item)}
            />
          ))}
        </div>
      </div>

      {detailItem && (
        <MovieDetailModal
          item={detailItem}
          poster={posters[detailItem.rec.title] ?? null}
          onClose={() => setDetailItem(null)}
        />
      )}
    </>
  );
}

function LikedThumbnail({
  item,
  poster,
  isNew,
  onDetail,
}: {
  item: SwipeItem;
  poster: string | null;
  isNew: boolean;
  onDetail: () => void;
}) {
  const { rec } = item;
  const color = colorForPlatform(rec.platform as never);
  return (
    <button
      onClick={onDetail}
      className="group relative h-[142px] w-[108px] overflow-hidden rounded-xl shadow-card transition-transform hover:scale-[1.03] active:scale-[0.98]"
      style={isNew ? { animation: "pile-card-in 0.32s cubic-bezier(0.34,1.56,0.64,1) both" } : undefined}
    >
      {poster ? (
        <img src={poster} alt={rec.title} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ background: `${color}18` }}>
          <span className="text-3xl font-black" style={{ color, opacity: 0.18 }}>{rec.title.charAt(0)}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <div className="rounded-full bg-black/40 p-1.5 backdrop-blur-sm">
          <Eye className="h-4 w-4 text-white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 px-2 pb-2">
        <p className="line-clamp-2 text-[9px] font-semibold leading-tight text-white">{rec.title}</p>
        <div className="mt-0.5 flex items-center gap-0.5">
          <span className="h-1 w-1 rounded-full" style={{ background: color }} />
          <span className="text-[8px] text-white/70">{rec.platform}</span>
        </div>
      </div>
    </button>
  );
}

/* ── MovieDetailModal — shared by pile thumbnails ────────────────────────── */

function MovieDetailModal({
  item,
  poster,
  onClose,
}: {
  item: SwipeItem;
  poster: string | null;
  onClose: () => void;
}) {
  const { rec } = item;
  const color = colorForPlatform(rec.platform as never);
  const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(rec.title + " trailer")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-[320px] overflow-hidden rounded-3xl bg-white shadow-float animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-[260px]">
          {poster ? (
            <img src={poster} alt={rec.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ background: `${color}14` }}>
              <span className="text-7xl font-black" style={{ color, opacity: 0.12 }}>{rec.title.charAt(0)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity hover:opacity-80"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 left-3">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              <span className="text-[11px] font-semibold text-white">{rec.platform}</span>
            </div>
          </div>
        </div>
        <div className="p-5">
          <h3 className="text-[18px] font-bold leading-tight tracking-tight text-foreground">{rec.title}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground/60">{rec.duration} · {rec.type}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-foreground/70">{rec.reason}</p>
          <div className="mt-4 flex gap-2">
            <a
              href={deepLinkFor(rec.platform, rec.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: color }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver en {rec.platform}
            </a>
            <a
              href={trailerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-full border border-red-200 px-4 py-3 text-[13px] font-semibold text-red-500 transition-colors hover:bg-red-50"
            >
              <Youtube className="h-3.5 w-3.5" />
              Tráiler
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── FinalPickCard — shown when choose mode AI makes its final pick ────────── */

function FinalPickCard({ item, poster }: { item: SwipeItem; poster: string | null }) {
  const [showDetail, setShowDetail] = useState(false);
  const { rec } = item;
  const color = colorForPlatform(rec.platform as never);
  const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(rec.title + " trailer")}`;

  return (
    <>
      <div className="overflow-hidden rounded-2xl rounded-tl-[4px] bg-white shadow-card">
        <div className="flex">
          <div
            className="relative h-[172px] w-[115px] shrink-0 cursor-pointer overflow-hidden"
            style={!poster ? { background: `${color}12` } : undefined}
            onClick={() => setShowDetail(true)}
          >
            {poster ? (
              <img src={poster} alt={rec.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-3xl font-black opacity-[0.12]" style={{ color }}>{rec.title.charAt(0)}</span>
              </div>
            )}
            {/* Eye overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/20">
              <Eye className="h-5 w-5 text-white opacity-0 transition-opacity hover:opacity-100" />
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-between p-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: `${color}14` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[10px] font-semibold" style={{ color }}>{rec.platform}</span>
              </div>
              <h3 className="text-[15px] font-bold leading-tight tracking-tight text-foreground">{rec.title}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{rec.duration} · {rec.type}</p>
              <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-foreground/60">{rec.reason}</p>
            </div>
            <div className="mt-3 flex gap-2">
              <a
                href={deepLinkFor(rec.platform, rec.title)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-85"
                style={{ background: color }}
              >
                <ExternalLink className="h-3 w-3" />
                Ver ahora
              </a>
              <a
                href={trailerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 rounded-full border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-500 transition-colors hover:bg-red-50"
              >
                <Youtube className="h-3 w-3" />
                Tráiler
              </a>
            </div>
          </div>
        </div>
      </div>
      {showDetail && (
        <MovieDetailModal item={item} poster={poster} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
