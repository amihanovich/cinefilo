import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ArrowUp,
  Eye,
  Bookmark,
  RefreshCw,
  ExternalLink,
  RotateCcw,
  X,
  Youtube,
  ThumbsDown,
} from "lucide-react";
import { PosterMarquee } from "@/components/PosterMarquee";
import { MicButton } from "@/components/MicButton";
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
import {
  PLATFORM_OPTIONS,
  colorForPlatform,
  deepLinkFor,
  type Platform,
  type RecommendationsResult,
  type Recommendation,
} from "@/lib/recommendations";
import { recommendConversational } from "@/lib/recommendations.functions";
import { recordTitleFeedback } from "@/lib/feedback.functions";
import { getProfile, setDefaultPlatforms } from "@/lib/profile.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

type FeedbackSentiment = "seen" | "watchlist" | "dislike";

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

/* ===================== HOME PAGE ===================== */

function HomePage() {
  const qc = useQueryClient();
  const [step, setStep] = useState<"home" | "results">("home");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RecommendationsResult | null>(null);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, FeedbackSentiment>>({});
  const [searchHistory, setSearchHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [guestSeedVersion, setGuestSeedVersion] = useState(0);

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

  const effectivePlatforms = selectedPlatforms.length > 0 ? selectedPlatforms : (PLATFORM_OPTIONS as Platform[]);

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
      setResult(null);
      setExcluded([]);
      setPosters({});
      setFeedbackGiven({});
      setSearchHistory([]);
    };
    window.addEventListener("que-veo:go-home", handler);
    return () => window.removeEventListener("que-veo:go-home", handler);
  }, []);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;

    if (step === "home") pushRecentSearch(trimmed);

    setIsLoading(true);
    const ctx = inferContext();
    const newHistory = [...searchHistory, { role: "user" as const, content: trimmed }];

    try {
      const data = await recommendConversational({
        data: {
          messages: newHistory,
          platforms: effectivePlatforms,
          contextHint: contextToPromptHint(ctx),
          seasonHint: seasonHintShort(ctx),
          weatherHint: weather ? weatherHintShort(weather) : null,
          excludeTitles: excluded,
          profileSeed: isGuest ? seedForServer(readGuestSeed()) : undefined,
        },
      });

      const assistantSummary = `Recomendé: ${data.main.title} (${data.main.platform}), alternativas: ${data.alternatives.map((a) => `${a.title} (${a.platform})`).join(", ")}`;
      setSearchHistory([...newHistory, { role: "assistant", content: assistantSummary }]);
      setResult(data);
      setStep("results");
      setPosters({});

      fetchPostersClient([
        { title: data.main.title, type: data.main.type },
        ...data.alternatives.map((a) => ({ title: a.title, type: a.type })),
      ]).then((map) => setPosters(map));

      if (isGuest) {
        bumpSearchCount();
        setGuestSeedVersion((v) => v + 1);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo salió mal.", { duration: 6000 });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = (title: string, platform: string, sentiment: FeedbackSentiment) => {
    setFeedbackGiven((prev) => ({ ...prev, [title]: sentiment }));
    if (sentiment === "dislike" || sentiment === "seen") {
      setExcluded((prev) => prev.includes(title) ? prev : [...prev, title]);
    }
    void recordTitleFeedback({ data: { title, platform, sentiment } }).catch(() => {});
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

  const handleNewSearch = () => {
    setStep("home");
    setResult(null);
    setExcluded([]);
    setPosters({});
    setFeedbackGiven({});
    setSearchHistory([]);
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

      {step === "results" && result && (
        <ResultsScreen
          result={result}
          isLoading={isLoading}
          posters={posters}
          feedbackGiven={feedbackGiven}
          onFeedback={handleFeedback}
          onRefine={submit}
          onNewSearch={handleNewSearch}
          isGuest={isGuest}
        />
      )}
    </main>
  );
}

/* ===================== HOME SCREEN ===================== */

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
      <PosterMarquee background />

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

      <div className="relative z-10 w-full max-w-lg rounded-3xl bg-background/80 px-8 py-8 shadow-float backdrop-blur-md ring-1 ring-black/[0.05]">
        <div className="mb-6 text-center">
          <p className="text-[21px] font-bold tracking-tight text-foreground">
            Describí lo que querés ver y te recomendamos qué mirar hoy.
          </p>
        </div>

        <div className="relative">
          <div className={cn(
            "flex items-center gap-3 rounded-2xl bg-white px-5 shadow-card transition-all duration-200",
            focused && "shadow-float",
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
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={text.trim().length < 2}
                  className={cn(
                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
                    text.trim().length >= 2 ? "bg-foreground text-background hover:opacity-80" : "bg-muted text-muted-foreground/20",
                  )}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>

          {showDropdown && (
            <div ref={dropdownRef} className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-2xl bg-white shadow-float animate-fade-in">
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
                  {recent.length === 0 && (
                    <div className="mb-1.5 pt-3">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Sugerencias</span>
                    </div>
                  )}
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

/* ===================== RESULTS SCREEN ===================== */

function ResultsScreen({
  result,
  isLoading,
  posters,
  feedbackGiven,
  onFeedback,
  onRefine,
  onNewSearch,
  isGuest,
}: {
  result: RecommendationsResult;
  isLoading: boolean;
  posters: Record<string, string | null>;
  feedbackGiven: Record<string, FeedbackSentiment>;
  onFeedback: (title: string, platform: string, sentiment: FeedbackSentiment) => void;
  onRefine: (text: string) => void;
  onNewSearch: () => void;
  isGuest: boolean;
}) {
  const [refineText, setRefineText] = useState("");
  const { main, alternatives } = result;

  const handleRefine = () => {
    if (refineText.trim().length >= 2) { onRefine(refineText.trim()); setRefineText(""); }
  };

  return (
    <section className="mx-auto max-w-2xl px-4 pb-12 pt-6 sm:px-6 animate-fade-in">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Para vos esta noche</h2>
        <button
          onClick={onNewSearch}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
          Nueva búsqueda
        </button>
      </div>

      {/* Main card */}
      <div className={cn("transition-opacity duration-300", isLoading && "opacity-40 pointer-events-none")}>
        <MainResultCard
          rec={main}
          poster={posters[main.title] ?? null}
          feedback={feedbackGiven[main.title] ?? null}
          onFeedback={(s) => onFeedback(main.title, main.platform, s)}
          isGuest={isGuest}
        />

        {/* Alternatives carousel */}
        {alternatives.length > 0 && (
          <div className="mt-6">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
              También podrías ver
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
              {alternatives.slice(0, 4).map((alt) => (
                <AltResultCard
                  key={alt.title}
                  rec={alt}
                  poster={posters[alt.title] ?? null}
                  feedback={feedbackGiven[alt.title] ?? null}
                  onFeedback={(s) => onFeedback(alt.title, alt.platform, s)}
                  isGuest={isGuest}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Refine bar */}
      <div className="mt-8">
        <p className="mb-2 text-center text-[12px] text-muted-foreground/55">
          ¿No era lo que buscabas? Refiná tu búsqueda:
        </p>
        <div className={cn(
          "flex items-center gap-3 rounded-2xl bg-white px-4 shadow-card transition-all duration-200",
          isLoading && "opacity-60 pointer-events-none",
        )}>
          <input
            type="text"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRefine(); }}
            placeholder={isLoading ? "Buscando…" : "Algo más corto, sin violencia, de los 80s…"}
            disabled={isLoading}
            className="min-h-[52px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/35 focus:outline-none"
          />
          <MicButton
            size="sm"
            onTranscript={(t, isFinal) => {
              if (!t) { setRefineText(""); return; }
              if (isFinal) { onRefine(t.trim()); setRefineText(""); }
              else setRefineText(t);
            }}
          />
          <button
            type="button"
            onClick={handleRefine}
            disabled={refineText.trim().length < 2 || isLoading}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
              refineText.trim().length >= 2
                ? "bg-foreground text-background hover:opacity-80"
                : "bg-muted text-muted-foreground/20",
            )}
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {isGuest && (
        <p className="mt-6 text-center text-[11px] text-muted-foreground/60">
          ¿Querés que recuerde tus gustos?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">Crear cuenta gratis →</Link>
        </p>
      )}
    </section>
  );
}

/* ===================== MAIN RESULT CARD ===================== */

function MainResultCard({
  rec,
  poster,
  feedback,
  onFeedback,
  isGuest,
}: {
  rec: Recommendation;
  poster: string | null;
  feedback: FeedbackSentiment | null;
  onFeedback: (s: FeedbackSentiment) => void;
  isGuest: boolean;
}) {
  const color = colorForPlatform(rec.platform as never);
  const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(rec.title + " trailer")}`;
  const dismissed = feedback === "dislike" || feedback === "seen";

  return (
    <div className={cn("overflow-hidden rounded-2xl bg-white shadow-float transition-opacity duration-300", dismissed && "opacity-40")}>
      <div className="flex">
        {/* Poster */}
        <div
          className="relative h-[220px] w-[148px] shrink-0 overflow-hidden"
          style={!poster ? { background: `${color}12` } : undefined}
        >
          {poster ? (
            <img src={poster} alt={rec.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-5xl font-black opacity-[0.08]" style={{ color }}>{rec.title.charAt(0)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/5" />
        </div>

        {/* Info */}
        <div className="flex flex-1 flex-col justify-between p-5">
          <div>
            <div
              className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
              style={{ background: `${color}14` }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              <span className="text-[11px] font-semibold" style={{ color }}>{rec.platform}</span>
            </div>
            <h2 className="text-[20px] font-bold leading-tight tracking-tight text-foreground">{rec.title}</h2>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <p className="text-[12px] text-muted-foreground/60">{rec.duration} · {rec.type}{rec.year ? ` · ${rec.year}` : ""}</p>
              {rec.ageRating && <AgeRatingBadge rating={rec.ageRating} />}
            </div>
            <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-foreground/65">{rec.reason}</p>
          </div>

          <div className="mt-4 flex gap-2">
            <a
              href={deepLinkFor(rec.platform, rec.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: color }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver ahora
            </a>
            <a
              href={trailerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-full border border-red-200 px-4 py-2.5 text-[12px] font-semibold text-red-500 transition-colors hover:bg-red-50"
            >
              <Youtube className="h-3.5 w-3.5" />
              Tráiler
            </a>
          </div>
        </div>
      </div>

      {/* Action row */}
      {!isGuest && (
        <div className="flex items-center gap-1 border-t border-black/[0.04] px-4 py-2">
          <ActionBtn
            active={feedback === "seen"}
            activeClass="bg-muted text-foreground"
            hoverClass="hover:bg-muted hover:text-foreground"
            onClick={() => onFeedback("seen")}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Ya la vi"
          />
          <ActionBtn
            active={feedback === "watchlist"}
            activeClass="bg-primary/10 text-primary"
            hoverClass="hover:bg-primary/8 hover:text-primary"
            onClick={() => onFeedback("watchlist")}
            icon={<Bookmark className="h-3.5 w-3.5" />}
            label="Guardar"
          />
          <div className="flex-1" />
          <ActionBtn
            active={feedback === "dislike"}
            activeClass="bg-destructive/10 text-destructive"
            hoverClass="hover:bg-destructive/8 hover:text-destructive"
            onClick={() => onFeedback("dislike")}
            icon={<ThumbsDown className="h-3.5 w-3.5" />}
            label="No me gusta"
          />
        </div>
      )}
    </div>
  );
}

/* ===================== ALT RESULT CARD ===================== */

function AltResultCard({
  rec,
  poster,
  feedback,
  onFeedback,
  isGuest,
}: {
  rec: Recommendation;
  poster: string | null;
  feedback: FeedbackSentiment | null;
  onFeedback: (s: FeedbackSentiment) => void;
  isGuest: boolean;
}) {
  const color = colorForPlatform(rec.platform as never);
  const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(rec.title + " trailer")}`;
  const dismissed = feedback === "dislike" || feedback === "seen";

  return (
    <div className={cn("w-[172px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-card transition-opacity duration-300", dismissed && "opacity-40")}>
      {/* Poster */}
      <div
        className="relative h-[110px] w-full overflow-hidden"
        style={!poster ? { background: `${color}12` } : undefined}
      >
        {poster ? (
          <img src={poster} alt={rec.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-3xl font-black opacity-[0.08]" style={{ color }}>{rec.title.charAt(0)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-3">
        <div
          className="inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5"
          style={{ background: `${color}14` }}
        >
          <span className="h-1 w-1 rounded-full" style={{ background: color }} />
          <span className="text-[9px] font-semibold" style={{ color }}>{rec.platform}</span>
        </div>
        <h3 className="line-clamp-2 text-[12px] font-bold leading-tight tracking-tight text-foreground">{rec.title}</h3>
        <div className="flex items-center gap-1 flex-wrap">
          <p className="text-[10px] text-muted-foreground/60">{rec.duration} · {rec.type}{rec.year ? ` · ${rec.year}` : ""}</p>
          {rec.ageRating && <AgeRatingBadge rating={rec.ageRating} size="xs" />}
        </div>
        <p className="line-clamp-2 text-[10px] leading-relaxed text-foreground/55">{rec.reason}</p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 border-t border-black/[0.04] px-3 py-2">
        <a
          href={deepLinkFor(rec.platform, rec.title)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-[10px] font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: color }}
        >
          <ExternalLink className="h-2.5 w-2.5" />
          Ver
        </a>
        <a
          href={trailerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-full border border-red-200 px-2.5 py-2 text-red-500 transition-colors hover:bg-red-50"
          title="Ver tráiler"
        >
          <Youtube className="h-3 w-3" />
        </a>
        {!isGuest && (
          <>
            <button
              onClick={() => onFeedback("seen")}
              title="Ya la vi"
              className={cn(
                "flex items-center justify-center rounded-full px-2.5 py-2 transition-colors",
                feedback === "seen" ? "bg-muted text-foreground" : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
              )}
            >
              <Eye className="h-3 w-3" />
            </button>
            <button
              onClick={() => onFeedback("dislike")}
              title="No me gusta"
              className={cn(
                "flex items-center justify-center rounded-full px-2.5 py-2 transition-colors",
                feedback === "dislike" ? "text-destructive" : "text-muted-foreground/50 hover:text-destructive",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ===================== SHARED ===================== */

function ageRatingColor(rating: string): string {
  const r = rating.toUpperCase();
  if (r === "ATP") return "#16a34a";   // green
  if (r === "PG")  return "#2563eb";   // blue
  if (r === "+13") return "#d97706";   // amber
  if (r === "+16") return "#ea580c";   // orange
  if (r === "+18") return "#dc2626";   // red
  return "#6b7280";
}

function AgeRatingBadge({ rating, size = "sm" }: { rating: string; size?: "sm" | "xs" }) {
  const color = ageRatingColor(rating);
  if (size === "xs") {
    return (
      <span
        className="inline-flex items-center rounded px-1 py-0.5 text-[8px] font-bold leading-none"
        style={{ color, background: `${color}18` }}
      >
        {rating}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none"
      style={{ color, background: `${color}18` }}
    >
      {rating}
    </span>
  );
}

function ActionBtn({
  active,
  activeClass,
  hoverClass,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  activeClass: string;
  hoverClass: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors",
        active ? activeClass : cn("text-muted-foreground/55", hoverClass),
      )}
    >
      {icon}
      {label}
    </button>
  );
}
