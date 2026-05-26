import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Sparkles, ArrowLeft, Plus, Bookmark, Check, X, ArrowUp, ThumbsUp, ThumbsDown, Heart, RefreshCw, EyeOff, Sliders, PenLine, Settings2, CloudSun, Film, MapPin, AlertTriangle } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  PLATFORM_OPTIONS,
  TIME_OPTIONS,
  COMPANY_OPTIONS,
  MOOD_OPTIONS,
  TYPE_OPTIONS,
  ATTENTION_OPTIONS,
  NOVELTY_OPTIONS,
  colorForPlatform,
  deepLinkFor,
  type Platform,
  type SituationFilters,
  type Recommendation,
  type RecommendationsResult,
} from "@/lib/recommendations";
import {
  recommendFromText,
  recommendFromFilters,
  inferMomentFilters,
} from "@/lib/recommendations.functions";
import { recordTitleFeedback } from "@/lib/feedback.functions";
import { fetchPosters } from "@/lib/posters.functions";
import { Onboarding } from "@/components/Onboarding";
import {
  readGuestSeed,
  seedForServer,
  isOnboarded,
  bumpSearchCount,
  dismissLoginNudge,
} from "@/lib/guestSeed";

import {
  listMoments,
  saveMoment,
  detectPattern,
  getProfile,
  setDefaultPlatforms,
  type MomentRow,
} from "@/lib/moments.functions";
import { inferContext, contextToPromptHint, seasonHintShort } from "@/lib/context";
import {
  getWeatherSnapshot,
  isWeatherEnabled,
  setWeatherEnabled,
  weatherHintShort,
  type WeatherSnapshot,
} from "@/lib/environment";
import { cn } from "@/lib/utils";
import { MicButton } from "@/components/MicButton";


export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

type Step = "home" | "filters" | "loading" | "results";

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

function HomePage() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("home");
  const [freeText, setFreeText] = useState("");
  const [filters, setFilters] = useState<SituationFilters>({
    time: null,
    company: null,
    mood: null,
    type: null,
    attention: null,
    novelty: null,
    platforms: [],
  });
  const [results, setResults] = useState<RecommendationsResult | null>(null);
  const [resultsSource, setResultsSource] = useState<"text" | "filters" | "moment">("filters");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [postersLoading, setPostersLoading] = useState(false);

  const loadPostersFor = (data: RecommendationsResult) => {
    const items = [data.main, ...data.alternatives].map((r) => ({
      title: r.title,
      type: r.type,
    }));
    setPostersLoading(true);
    fetchPosters({ data: { items } })
      .then((res) => setPosters((prev) => ({ ...prev, ...res.posters })))
      .catch(() => {})
      .finally(() => setPostersLoading(false));
  };

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

  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [guestSeedVersion, setGuestSeedVersion] = useState(0);
  useEffect(() => {
    if (!sessionReady) return;
    if (!isGuest) return;
    if (isOnboarded()) return;
    setShowOnboarding(true);
  }, [sessionReady, isGuest]);

  const [showLoginNudge, setShowLoginNudge] = useState(false);
  useEffect(() => {
    if (!sessionReady || !isGuest) {
      setShowLoginNudge(false);
      return;
    }
    const seed = readGuestSeed();
    setShowLoginNudge(seed.searchCount >= 3 && !seed.loginNudgeDismissedAt);
  }, [sessionReady, isGuest, guestSeedVersion]);

  const dismissNudge = () => {
    dismissLoginNudge();
    setShowLoginNudge(false);
  };

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
    enabled: !!session,
  });
  const { data: moments } = useQuery({
    queryKey: ["moments"],
    queryFn: () => listMoments(),
    enabled: !!session,
  });
  const { data: patternData } = useQuery({
    queryKey: ["pattern"],
    queryFn: () => detectPattern(),
    enabled: step === "results" && !!session,
  });

  const defaultPlatforms = (
    isGuest ? guestPlatforms : (profile?.default_platforms ?? [])
  ) as Platform[];

  const effectivePlatforms = (
    filters.platforms.length > 0 ? filters.platforms : defaultPlatforms
  ) as Platform[];

  const [useLocation, setUseLocation] = useState<boolean>(() => isWeatherEnabled());
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    if (!useLocation) return;
    setWeatherLoading(true);
    getWeatherSnapshot()
      .then((w) => setWeather(w))
      .finally(() => setWeatherLoading(false));
  }, [useLocation]);

  const toggleLocation = async (enabled: boolean) => {
    setWeatherEnabled(enabled);
    setUseLocation(enabled);
    if (!enabled) {
      setWeather(null);
      return;
    }
    setWeatherLoading(true);
    const w = await getWeatherSnapshot();
    setWeather(w);
    setWeatherLoading(false);
  };

  const buildEnvHints = () => {
    const ctx = inferContext();
    return {
      contextHint: contextToPromptHint(ctx),
      seasonHint: seasonHintShort(ctx),
      weatherHint: weather ? weatherHintShort(weather) : null,
    };
  };

  const runText = async (excludeList: string[] = excluded, textOverride?: string) => {
    const text = (textOverride ?? freeText).trim();
    if (text.length < 3) return;
    const plats =
      effectivePlatforms.length > 0 ? effectivePlatforms : (PLATFORM_OPTIONS as Platform[]);
    setError(null);
    setResultsSource("text");
    setStep("loading");
    try {
      const env = buildEnvHints();
      const data = await recommendFromText({
        data: {
          text,
          platforms: plats,
          contextHint: env.contextHint,
          seasonHint: env.seasonHint,
          weatherHint: env.weatherHint,
          excludeTitles: excludeList,
          profileSeed: isGuest ? seedForServer(readGuestSeed()) : undefined,
        },
      });
      setResults(data);
      loadPostersFor(data);
      setStep("results");
      if (isGuest) {
        bumpSearchCount();
        setGuestSeedVersion((v) => v + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal.");
      setStep("home");
    }
  };

  const runFilters = async (
    source: "filters" | "moment",
    overrideFilters?: SituationFilters,
    extraText?: string,
    excludeList: string[] = excluded,
  ) => {
    const f = overrideFilters ?? filters;
    let plats = (f.platforms.length > 0 ? f.platforms : defaultPlatforms) as Platform[];
    if (plats.length === 0) plats = PLATFORM_OPTIONS as Platform[];
    setError(null);
    setResultsSource(source);
    setStep("loading");
    try {
      const env = buildEnvHints();
      const data = await recommendFromFilters({
        data: {
          time: f.time,
          company: f.company,
          mood: f.mood,
          type: f.type,
          attention: f.attention,
          novelty: f.novelty,
          platforms: plats,
          contextHint: env.contextHint,
          seasonHint: env.seasonHint,
          weatherHint: env.weatherHint,
          source,
          extraText: extraText ?? null,
          excludeTitles: excludeList,
          profileSeed: isGuest ? seedForServer(readGuestSeed()) : undefined,
        },
      });
      setResults(data);
      loadPostersFor(data);
      setStep("results");
      if (!isGuest) qc.invalidateQueries({ queryKey: ["pattern"] });
      if (isGuest) {
        bumpSearchCount();
        setGuestSeedVersion((v) => v + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal.");
      setStep("home");
    }
  };

  const handleSeen = (title: string, platform: string) => {
    if (!excluded.includes(title)) setExcluded([...excluded, title]);
    void recordTitleFeedback({ data: { title, platform, sentiment: "seen" } }).catch(() => {});
  };

  const handleFeedback = (title: string, platform: string, sentiment: "like" | "love" | "dislike") => {
    void recordTitleFeedback({ data: { title, platform, sentiment } }).catch(() => {});
    if (sentiment === "dislike" && !excluded.includes(title)) setExcluded([...excluded, title]);
  };

  const rerunExcludingSeen = () => {
    if (resultsSource === "text") {
      runText(excluded);
    } else {
      runFilters(
        resultsSource,
        undefined,
        freeText.trim().length >= 3 ? freeText.trim() : undefined,
        excluded,
      );
    }
  };

  const useMoment = (m: MomentRow) => {
    const f: SituationFilters = {
      time: (m.time_filter as SituationFilters["time"]) ?? null,
      company: (m.company_filter as SituationFilters["company"]) ?? null,
      mood: (m.mood_filter as SituationFilters["mood"]) ?? null,
      type: (m.type_filter as SituationFilters["type"]) ?? null,
      attention: (m.attention_filter as SituationFilters["attention"]) ?? null,
      novelty: (m.novelty_filter as SituationFilters["novelty"]) ?? null,
      platforms: (m.platforms as Platform[]) ?? [],
    };
    setFilters(f);
    setExcluded([]);
    if (m.use_location && !useLocation) {
      toggleLocation(true);
    }
    const extra = freeText.trim().length >= 3 ? freeText.trim() : undefined;
    runFilters("moment", f, extra, []);
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

  const runSurprise = (excludeList: string[] = []) => {
    setExcluded(excludeList);
    const emptyFilters: SituationFilters = {
      time: null,
      company: null,
      mood: null,
      type: null,
      attention: null,
      novelty: null,
      platforms: filters.platforms,
    };
    runFilters("filters", emptyFilters, undefined, excludeList);
  };

  const handleRefresh = () => runSurprise([]);

  const retryLast = () => {
    if (resultsSource === "text") {
      runText(excluded);
    } else {
      runFilters(
        resultsSource === "moment" ? "moment" : "filters",
        undefined,
        freeText.trim().length >= 3 ? freeText.trim() : undefined,
        excluded,
      );
    }
  };

  const [setupMode, setSetupMode] = useState(false);

  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    if (!sessionReady) return;
    bootRef.current = true;
  }, [sessionReady]);

  const showSetup = setupMode && !results;
  const showLoading = !setupMode && step === "loading";
  const showResults = !setupMode && step === "results" && !!results;
  const showHome = !setupMode && !showLoading && !showResults;

  return (
    <main className="mx-auto max-w-6xl px-6 pb-12 sm:px-8">
      {showOnboarding && (
        <Onboarding
          onDone={() => {
            setShowOnboarding(false);
            setGuestSeedVersion((v) => v + 1);
          }}
        />
      )}

      {showLoginNudge && showSetup && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/60 to-card/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
              <Heart className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                Guardá tu perfil de gusto
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Llevás varias búsquedas. Si querés que tus Momentos, plataformas y feedback te sigan
                en cualquier dispositivo, creá tu cuenta. Sin emails ni datos compartidos.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-smooth hover:bg-primary/90"
                >
                  Guardar mi perfil →
                </Link>
                <button
                  onClick={dismissNudge}
                  className="text-xs font-medium text-muted-foreground transition-smooth hover:text-foreground"
                >
                  Ahora no
                </button>
              </div>
            </div>
            <button
              onClick={dismissNudge}
              aria-label="Cerrar"
              className="text-muted-foreground transition-smooth hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {(showSetup || showHome) && (
        <HomeScreen
          freeText={freeText}
          onFreeTextChange={setFreeText}
          onSubmitText={() => {
            setExcluded([]);
            setSetupMode(false);
            runText([]);
          }}
          filters={filters}
          onFiltersChange={setFilters}
          onSubmitFilters={() => {
            setExcluded([]);
            setSetupMode(false);
            runFilters("filters", undefined, undefined, []);
          }}
          onSurprise={() => {
            setSetupMode(false);
            runSurprise([]);
          }}
          onSaveDefaultPlatforms={saveDefaultPlatforms}
          defaultPlatforms={defaultPlatforms}
          moments={isGuest ? [] : (moments ?? [])}
          onUseMoment={(m) => {
            setSetupMode(false);
            useMoment(m);
          }}
          error={error}
          onRetry={retryLast}
          isGuest={isGuest}
          useLocation={useLocation}
          weather={weather}
          weatherLoading={weatherLoading}
          onToggleLocation={toggleLocation}
        />
      )}
      {showLoading && <LoadingScreen />}
      {showResults && results && (
        <ResultsScreen
          results={results}
          resolvedFilters={filters}
          source={resultsSource}
          freeText={freeText}
          patternSuggestion={isGuest ? null : (patternData?.suggestion ?? null)}
          existingMoments={isGuest ? [] : (moments ?? [])}
          onBack={handleRefresh}
          onOpenSetup={() => setSetupMode(true)}
          onSearchText={(t) => {
            setFreeText(t);
            setExcluded([]);
            runText([], t);
          }}
          onSearchFilters={(f) => {
            setFilters(f);
            setExcluded([]);
            runFilters("filters", f, undefined, []);
          }}
          currentFilters={filters}
          weather={weather}
          isGuest={isGuest}
          excludedCount={excluded.length}
          onSeen={handleSeen}
          onFeedback={handleFeedback}
          onRerunExcludingSeen={rerunExcludingSeen}
          isGuestForFeedback={isGuest}
          posters={posters}
          postersLoading={postersLoading}
          onSaveMoment={async (name) => {
            const ctx = inferContext();
            await saveMoment({
              data: {
                name,
                time_filter: results.filters.time,
                company_filter: results.filters.company,
                mood_filter: results.filters.mood,
                type_filter: results.filters.type,
                attention_filter: results.filters.attention ?? filters.attention ?? null,
                novelty_filter: results.filters.novelty ?? filters.novelty ?? null,
                season_hint: seasonHintShort(ctx),
                weather_hint: weather ? weatherHintShort(weather) : null,
                use_location: useLocation,
                platforms: effectivePlatforms,
                auto_detected: false,
              },
            });
            qc.invalidateQueries({ queryKey: ["moments"] });
          }}
        />
      )}
    </main>
  );
}

/* ===================== HOME ===================== */

function LiveDemoCard() {
  const examples = [
    {
      title: "El Silencio de los Datos",
      platform: "DISNEY+",
      duration: "1h 52m",
      reason:
        "Un martes a las 23h, con clima nublado, necesitás algo que te atrape sin sacarte el sueño.",
      gradient: "from-indigo-700 via-purple-900 to-slate-900",
    },
    {
      title: "Noches de Tokio",
      platform: "NETFLIX",
      duration: "8 ep · 45 min",
      reason:
        "Para una cena solo, neón y jazz: te dura toda la semana sin pedirte concentración.",
      gradient: "from-cyan-700 via-indigo-900 to-black",
    },
    {
      title: "La Última Carta",
      platform: "MAX",
      duration: "2h 08m",
      reason:
        "Domingo lluvioso con tu pareja, querés sentir algo. Sin spoilers: lloran los dos.",
      gradient: "from-rose-800 via-indigo-950 to-slate-950",
    },
  ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % examples.length), 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ex = examples[idx];

  return (
    <div className="relative w-full max-w-[440px]">
      <div
        className="pointer-events-none absolute -inset-10 rounded-full bg-primary/10 blur-[100px]"
        aria-hidden="true"
      />

      <div className="group relative overflow-hidden rounded-[40px] border border-border bg-card shadow-card transition-transform duration-500 hover:scale-[1.01]">
        <div className="relative h-[420px] overflow-hidden">
          <div
            key={idx}
            className={cn(
              "h-full w-full bg-gradient-to-br transition-transform duration-1000 group-hover:scale-105 animate-fade-in",
              ex.gradient,
            )}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-black/30" />
          <div className="absolute left-6 top-6">
            <span className="rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-[10px] font-black tracking-[0.2em] text-foreground backdrop-blur-md shadow-xl">
              {ex.platform}
            </span>
          </div>
        </div>

        <div className="relative -mt-20 p-8">
          <div className="mb-5 flex items-center gap-3">
            <span className="rounded-md border border-primary/30 bg-primary/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              Recomendado
            </span>
            <span className="text-sm font-medium text-muted-foreground">{ex.duration}</span>
          </div>

          <h2 className="mb-5 font-display text-2xl font-bold leading-tight text-foreground lg:text-3xl">
            ¿Por qué verla?
          </h2>

          <div className="relative mb-8">
            <div
              className="absolute bottom-0 left-0 top-0 w-1 rounded-full bg-gradient-to-b from-primary to-transparent"
              aria-hidden="true"
            />
            <p className="pl-6 text-base italic leading-relaxed text-foreground/85 lg:text-lg">
              "{ex.reason}"
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-foreground py-4 text-center font-display text-sm font-bold tracking-wide text-background">
              Ver ahora
            </div>
            <div className="rounded-2xl border border-border py-4 text-center font-display text-sm font-bold tracking-wide text-foreground">
              Afinar
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function HomeScreen({
  freeText,
  onFreeTextChange,
  onSubmitText,
  filters,
  onFiltersChange,
  onSubmitFilters,
  onSurprise,
  onSaveDefaultPlatforms,
  defaultPlatforms,
  moments,
  onUseMoment,
  error,
  onRetry,
  isGuest,
  useLocation,
  weather,
  weatherLoading,
  onToggleLocation,
}: {
  freeText: string;
  onFreeTextChange: (v: string) => void;
  onSubmitText: () => void;
  filters: SituationFilters;
  onFiltersChange: (f: SituationFilters) => void;
  onSubmitFilters: () => void;
  onSurprise: () => void;
  onSaveDefaultPlatforms: (plats: Platform[]) => Promise<void>;
  defaultPlatforms: string[];
  moments: MomentRow[];
  onUseMoment: (m: MomentRow) => void;
  error: string | null;
  onRetry: () => void;
  isGuest: boolean;
  useLocation: boolean;
  weather: WeatherSnapshot | null;
  weatherLoading: boolean;
  onToggleLocation: (enabled: boolean) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [restrictPlatforms, setRestrictPlatforms] = useState<boolean>(
    defaultPlatforms.length > 0,
  );

  useEffect(() => {
    if (defaultPlatforms.length > 0 && filters.platforms.length === 0) {
      onFiltersChange({ ...filters, platforms: defaultPlatforms as Platform[] });
      setRestrictPlatforms(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPlatforms.join(",")]);

  const togglePlatform = (p: Platform) => {
    const has = filters.platforms.includes(p);
    onFiltersChange({
      ...filters,
      platforms: has
        ? filters.platforms.filter((x) => x !== p)
        : [...filters.platforms, p],
    });
  };

  const activeFilterCount = [
    filters.time,
    filters.company,
    filters.mood,
    filters.type,
    filters.attention,
    filters.novelty,
  ].filter(Boolean).length;

  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(restrictPlatforms && filters.platforms.length > 0
      ? `${filters.platforms.length} plataforma${filters.platforms.length > 1 ? "s" : ""}`
      : "Todas las plataformas");
    if (useLocation) parts.push("ubicación on");
    return parts.join(" · ");
  }, [restrictPlatforms, filters.platforms, useLocation]);

  return (
    <section className="animate-fade-in">
      <div className="ambient-glow-top" aria-hidden="true" />
      <div className="ambient-glow-bottom" aria-hidden="true" />

      {/* HERO: pregunta + input izquierda, tarjeta-demo derecha */}
      <div className="flex flex-col items-center py-8 lg:grid lg:grid-cols-12 lg:gap-16 lg:py-16">
        <div className="flex w-full flex-col text-center lg:col-span-7 lg:text-left">
          <h1 className="mb-6 text-balance font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground md:text-7xl lg:text-[88px]">
            ¿Qué te resuelvo{" "}
            <span className="text-primary">esta noche?</span>
          </h1>
          <p className="mb-10 max-w-lg text-lg leading-relaxed text-muted-foreground lg:text-xl">
            Contanos tu mood y te damos una recomendación editorial definitiva en menos de 2 segundos.
          </p>

          <div className="group relative mx-auto w-full max-w-2xl lg:mx-0">
            <div className="absolute -inset-1 rounded-2xl bg-primary/20 opacity-0 blur-xl transition-all group-focus-within:opacity-100" aria-hidden="true" />
            <div className="relative flex items-center">
              <textarea
                value={freeText}
                onChange={(e) => onFreeTextChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (freeText.trim().length >= 3) onSubmitText();
                  }
                }}
                rows={1}
                placeholder="una serie cortita, no muy densa…"
                className="h-20 w-full resize-none rounded-2xl border border-border bg-input pl-7 pr-40 pt-7 text-lg font-medium text-foreground placeholder:text-muted-foreground/70 transition-smooth focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="absolute right-3 flex items-center gap-2">
                <MicButton
                  onTranscript={(t, isFinal) => {
                    if (!t || !isFinal) return;
                    onFreeTextChange(freeText ? `${freeText.trim()} ${t}` : t);
                  }}
                />
                <button
                  type="button"
                  onClick={onSubmitText}
                  disabled={freeText.trim().length < 3}
                  className={cn(
                    "inline-flex h-14 items-center justify-center gap-2 rounded-xl px-7 text-sm font-bold tracking-wide transition-smooth active:scale-95",
                    freeText.trim().length >= 3
                      ? "bg-primary text-primary-foreground shadow-primary hover:opacity-95"
                      : "cursor-not-allowed bg-muted text-muted-foreground/60",
                  )}
                >
                  <span>Pedir</span>
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-center lg:justify-start">
            <button
              type="button"
              onClick={onSurprise}
              className="inline-flex items-center gap-3 rounded-full border border-border bg-card/60 px-6 py-3 text-sm font-bold text-foreground/85 transition-smooth hover:border-primary/40 hover:bg-card"
              title="Recomendación basada en tu historial, el momento del día y el clima"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              Decidí vos por mí
            </button>
          </div>
        </div>

        <aside className="hidden w-full justify-center lg:col-span-5 lg:flex">
          <LiveDemoCard />
        </aside>
      </div>

      {/* Ajustes colapsables */}
      <button
        onClick={() => setOptionsOpen((v) => !v)}
        className="mt-10 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 px-4 py-3 text-left transition-smooth hover:border-primary/60"
        aria-expanded={optionsOpen}
      >
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Ajustes de búsqueda
          </div>
          <div className="mt-0.5 truncate text-[11px] text-foreground/70">
            {optionsSummary}
          </div>
        </div>
        <Plus
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
            optionsOpen && "rotate-45",
          )}
        />
      </button>

      {optionsOpen && (
        <div className="mt-2 space-y-4 rounded-2xl border border-border bg-card/40 p-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                ¿Dónde buscamos?
              </span>
              <div className="flex rounded-full border border-border bg-background p-0.5 text-[11px]">
                <button
                  onClick={() => setRestrictPlatforms(false)}
                  className={cn(
                    "rounded-full px-3 py-1 transition-smooth",
                    !restrictPlatforms
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Todas
                </button>
                <button
                  onClick={() => setRestrictPlatforms(true)}
                  className={cn(
                    "rounded-full px-3 py-1 transition-smooth",
                    restrictPlatforms
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Mis plataformas
                </button>
              </div>
            </div>

            {!restrictPlatforms ? (
              <p className="text-[11px] text-muted-foreground">
                Buscamos en todas las plataformas (puede sugerirte algo donde no estés suscrito).
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORM_OPTIONS.map((p) => {
                    const active = filters.platforms.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => togglePlatform(p)}
                        style={
                          active
                            ? {
                                borderColor: colorForPlatform(p),
                                background: `${colorForPlatform(p)}22`,
                              }
                            : undefined
                        }
                        className={cn(
                          "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-smooth",
                          active
                            ? "text-foreground"
                            : "border-border bg-card/50 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: colorForPlatform(p) }}
                        />
                        {p}
                      </button>
                    );
                  })}
                </div>
                {filters.platforms.length > 0 &&
                  JSON.stringify([...filters.platforms].sort()) !==
                    JSON.stringify([...defaultPlatforms].sort()) && (
                    <button
                      onClick={() => onSaveDefaultPlatforms(filters.platforms as Platform[])}
                      className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                    >
                      Guardar como mis plataformas predeterminadas
                    </button>
                  )}
              </>
            )}
          </div>

          <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3 text-primary" />
                Usar mi ubicación
              </div>
              {useLocation && weatherLoading && (
                <p className="mt-1 text-[11px] text-muted-foreground">Leyendo clima…</p>
              )}
              {useLocation && !weatherLoading && weather && (
                <p className="mt-1 text-[11px] text-primary">
                  Ahora: {weatherHintShort(weather)}
                </p>
              )}
              {useLocation && !weatherLoading && !weather && (
                <p className="mt-1 text-[11px] text-destructive">
                  No pudimos leer el clima (¿permiso denegado?).
                </p>
              )}
              {!useLocation && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Suma el clima actual al contexto. Tu ubicación no se guarda.
                </p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={useLocation}
              onClick={() => onToggleLocation(!useLocation)}
              className={cn(
                "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                useLocation ? "bg-primary" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background transition-transform",
                  useLocation ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 animate-fade-in">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/15">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Uy, no pudimos esta vez</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{error}</p>
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive transition-smooth hover:bg-destructive/25 active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reintentar
            </button>
          </div>
        </div>
      )}

      <div className="mt-10 flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">o</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Momentos */}
      <div className="mt-6">
        <div className="mb-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Bookmark className="h-4 w-4 text-primary" />
            Configurá un Momento
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Una situación recurrente (tiempo, compañía, mood…) que querés reusar.
            {" "}
            {freeText.trim().length >= 3 ? (
              <span className="text-primary">Tu texto de arriba se combina como matiz extra.</span>
            ) : (
              <span>También podés combinarlo con el texto de arriba.</span>
            )}
          </p>
          {!isGuest && moments.length > 0 && (
            <Link
              to="/moments"
              className="mt-1 inline-block text-[11px] text-muted-foreground hover:text-foreground"
            >
              Gestionar mis Momentos →
            </Link>
          )}
        </div>

        {!isGuest && moments.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            {moments.map((m) => (
              <button
                key={m.id}
                onClick={() => onUseMoment(m)}
                className="flex min-h-[88px] flex-col items-start gap-1 rounded-2xl border border-border bg-card/70 p-3 text-left transition-smooth hover:border-primary/60 hover:bg-card"
              >
                <span className="text-sm font-semibold text-foreground line-clamp-2">
                  {m.name}
                </span>
                <span className="text-[11px] text-muted-foreground line-clamp-2">
                  {summarizeMoment(m)}
                </span>
              </button>
            ))}
          </div>
        )}

        {isGuest && (
          <div className="mb-3 rounded-2xl border border-dashed border-border bg-transparent p-3 text-center text-[11px] text-muted-foreground">
            <Link to="/login" className="text-primary hover:underline">
              Iniciá sesión
            </Link>{" "}
            para guardar tus Momentos y reutilizarlos. Sin login, podés armar uno para esta búsqueda.
          </div>
        )}

        <button
          onClick={() => setCreateOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-transparent px-4 py-3 text-left transition-smooth hover:border-primary"
          aria-expanded={createOpen}
        >
          <div>
            <div className="text-sm font-semibold text-foreground">
              {createOpen ? "Armá tu Momento" : "Crear nuevo Momento"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {activeFilterCount > 0
                ? `${activeFilterCount} filtro${activeFilterCount > 1 ? "s" : ""} elegido${activeFilterCount > 1 ? "s" : ""}`
                : "Tiempo, compañía, mood, tipo"}
            </div>
          </div>
          <Plus
            className={cn(
              "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
              createOpen && "rotate-45",
            )}
          />
        </button>

        {createOpen && (
          <div className="mt-3 space-y-6 rounded-2xl border border-border bg-card/40 p-4">
            <MomentAiBuilder
              onInferred={(f) =>
                onFiltersChange({
                  ...filters,
                  time: (f.time as SituationFilters["time"]) ?? null,
                  company: (f.company as SituationFilters["company"]) ?? null,
                  mood: (f.mood as SituationFilters["mood"]) ?? null,
                  type: (f.type as SituationFilters["type"]) ?? null,
                  attention:
                    (f.attention as SituationFilters["attention"]) ?? filters.attention ?? null,
                  novelty:
                    (f.novelty as SituationFilters["novelty"]) ?? filters.novelty ?? null,
                })
              }
            />
            <FilterGroup
              label="¿Cuánto tiempo tenés?"
              options={TIME_OPTIONS}
              value={filters.time}
              onSelect={(v) =>
                onFiltersChange({ ...filters, time: v as SituationFilters["time"] })
              }
            />
            <FilterGroup
              label="¿Con quién?"
              options={COMPANY_OPTIONS}
              value={filters.company}
              onSelect={(v) =>
                onFiltersChange({ ...filters, company: v as SituationFilters["company"] })
              }
            />
            <FilterGroup
              label="¿Qué mood?"
              options={MOOD_OPTIONS}
              value={filters.mood}
              onSelect={(v) =>
                onFiltersChange({ ...filters, mood: v as SituationFilters["mood"] })
              }
            />
            <FilterGroup
              label="¿Tipo?"
              options={TYPE_OPTIONS}
              value={filters.type}
              onSelect={(v) =>
                onFiltersChange({ ...filters, type: v as SituationFilters["type"] })
              }
            />
            <FilterGroup
              label="¿Nivel de atención?"
              options={ATTENTION_OPTIONS}
              value={filters.attention}
              onSelect={(v) =>
                onFiltersChange({ ...filters, attention: v as SituationFilters["attention"] })
              }
            />
            <FilterGroup
              label="¿Novedad?"
              options={NOVELTY_OPTIONS}
              value={filters.novelty}
              onSelect={(v) =>
                onFiltersChange({ ...filters, novelty: v as SituationFilters["novelty"] })
              }
            />

            <button
              onClick={onSubmitFilters}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary px-6 text-sm font-semibold text-primary-foreground shadow-primary transition-smooth active:scale-[0.98]"
            >
              {isGuest ? "Buscar con este Momento" : "Buscar (y guardalo después)"}
            </button>
            {!isGuest && (
              <p className="-mt-3 text-center text-[11px] text-muted-foreground">
                Si te gustan los resultados, podrás guardarlo con nombre.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function summarizeMoment(m: MomentRow): string {
  const parts = [m.time_filter, m.company_filter, m.mood_filter, m.type_filter].filter(Boolean);
  if (parts.length === 0 && (m.platforms?.length ?? 0) > 0) {
    return m.platforms.slice(0, 3).join(" · ");
  }
  return parts.length > 0 ? parts.join(" · ") : "Sin filtros";
}

function MomentAiBuilder({
  onInferred,
}: {
  onInferred: (f: {
    time: string | null;
    company: string | null;
    mood: string | null;
    type: string | null;
    attention?: string | null;
    novelty?: string | null;
  }) => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const run = async () => {
    if (text.trim().length < 3) return;
    setLoading(true);
    setErr(null);
    setOk(false);
    try {
      const f = await inferMomentFilters({ data: { text: text.trim() } });
      onInferred(f);
      setOk(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No pudimos inferir.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
      <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-primary">
        <Sparkles className="mr-1 inline h-3 w-3" />
        Armalo con IA (opcional)
      </label>
      <div className="rounded-lg border border-primary/30 bg-input-surface transition-smooth focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOk(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!loading && text.trim().length >= 3) run();
            }
          }}
          rows={2}
          placeholder="Ej: viernes a la noche con mi pareja, algo liviano…"
          className="w-full resize-none bg-transparent px-3 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="text-[11px] text-muted-foreground">
            Pre-llenamos los filtros abajo.
          </span>
          <div className="flex items-center gap-2">
            <MicButton
              onTranscript={(t, isFinal) => {
                if (!t || !isFinal) return;
                setText((prev) => (prev ? `${prev.trim()} ${t}` : t));
                setOk(false);
              }}
            />
            <button
              type="button"
              onClick={run}
              disabled={loading || text.trim().length < 3}
              aria-label="Enviar"
              title="Enviar"
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full transition-smooth",
                loading || text.trim().length < 3
                  ? "cursor-not-allowed bg-background text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90 active:scale-95",
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
      {ok && (
        <p className="mt-2 text-[11px] text-primary">
          Listo — revisá y ajustá los filtros abajo.
        </p>
      )}
      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onSelect: (v: string | null) => void;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSelect(null)}
          className={cn(
            "min-h-[44px] rounded-full border px-4 text-xs font-semibold transition-smooth",
            value === null
              ? "border-primary bg-primary/15 text-primary"
              : "border-dashed border-border bg-transparent text-muted-foreground hover:border-primary hover:text-primary",
          )}
        >
          ✨ Que decida la IA
        </button>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onSelect(active ? null : opt)}
              className={cn(
                "min-h-[44px] rounded-full border px-4 text-sm font-medium transition-smooth",
                active
                  ? "border-transparent bg-primary text-primary-foreground shadow-primary"
                  : "border-border bg-card/50 text-foreground/80 hover:bg-card",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== QUICK CHIPS ===================== */

function QuickChips({
  label,
  options,
  value,
  onSelect,
  labelMap,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onSelect: (v: string | null) => void;
  labelMap?: Record<string, string>;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o;
          return (
            <button
              key={o}
              onClick={() => onSelect(active ? null : o)}
              className={cn(
                "inline-flex min-h-[32px] items-center rounded-full border px-3 text-[12px] font-medium transition-smooth",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {labelMap?.[o] ?? o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TIME_LABELS: Record<string, string> = {
  "30 min": "Hasta 30 min",
  "1 hora": "Una hora",
  "1.5 horas": "Una peli (90 min)",
  "Noche entera": "Maratón / noche entera",
};

/* ===================== LOADING ===================== */

function SkeletonCard({ main = false }: { main?: boolean }) {
  return (
    <div
      className={cn(
        "overflow-hidden bg-card/40",
        main ? "rounded-[2rem] border-2 border-primary/30" : "rounded-3xl border border-border",
      )}
    >
      <div className="aspect-[2/3] w-full animate-pulse bg-muted/40" />
      <div className={cn("space-y-3", main ? "p-6" : "p-5")}>
        <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        <div
          className={cn(
            "animate-pulse rounded bg-muted/50",
            main ? "h-7 w-3/4" : "h-5 w-2/3",
          )}
        />
        <div className="h-3 w-full animate-pulse rounded bg-muted/40" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-muted/40" />
        <div
          className={cn(
            "mt-2 animate-pulse rounded-xl bg-muted/40",
            main ? "h-12" : "h-9",
          )}
        />
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <section className="animate-fade-in pt-4">
      <div className="mb-6">
        <div className="h-8 w-52 animate-pulse rounded-lg bg-muted/50 sm:h-9" />
        <div className="mt-3 flex items-center gap-1.5 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Buscando algo perfecto para vos…</span>
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-3 md:items-center md:gap-6">
        <div className="order-2 hidden md:order-1 md:block">
          <SkeletonCard />
        </div>
        <div className="order-1 md:order-2 md:scale-[1.04]">
          <SkeletonCard main />
        </div>
        <div className="order-3 hidden md:block">
          <SkeletonCard />
        </div>
      </div>
    </section>
  );
}

/* ===================== RESULTS ===================== */

function ResultsScreen({
  results,
  source,
  freeText,
  patternSuggestion,
  existingMoments,
  onBack,
  onOpenSetup,
  onSearchText,
  onSearchFilters,
  currentFilters,
  weather,
  onSaveMoment,
  isGuest,
  excludedCount,
  onSeen,
  onFeedback,
  onRerunExcludingSeen,
  isGuestForFeedback,
  posters,
  postersLoading,
}: {
  results: RecommendationsResult;
  resolvedFilters: SituationFilters;
  source: "text" | "filters" | "moment";
  freeText: string;
  patternSuggestion: {
    time_filter: string | null;
    company_filter: string | null;
    mood_filter: string | null;
    type_filter: string | null;
    platforms: string[];
    count: number;
  } | null;
  existingMoments: MomentRow[];
  onBack: () => void;
  onOpenSetup: () => void;
  onSearchText: (text: string) => void;
  onSearchFilters: (filters: SituationFilters) => void;
  currentFilters: SituationFilters;
  weather: WeatherSnapshot | null;
  onSaveMoment: (name: string) => Promise<void>;
  isGuest: boolean;
  excludedCount: number;
  onSeen: (title: string, platform: string) => void;
  onFeedback: (title: string, platform: string, sentiment: "like" | "love" | "dislike") => void;
  onRerunExcludingSeen: () => void;
  isGuestForFeedback: boolean;
  posters: Record<string, string | null>;
  postersLoading: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPattern, setShowPattern] = useState(true);

  const [tunePanel, setTunePanel] = useState<"none" | "tune" | "write">("none");
  const [tuneFilters, setTuneFilters] = useState<SituationFilters>(currentFilters);
  const [tuneText, setTuneText] = useState<string>(source === "text" ? freeText : "");

  useEffect(() => {
    setTunePanel("none");
    setTuneFilters(currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const [cardState, setCardState] = useState<Record<string, "seen" | "like" | "love" | "dislike">>({});
  useEffect(() => {
    setCardState({});
  }, [results]);

  const markSeen = (rec: Recommendation) => {
    setCardState((s) => ({ ...s, [rec.title]: "seen" }));
    onSeen(rec.title, rec.platform);
  };
  const markFeedback = (rec: Recommendation, sentiment: "like" | "love" | "dislike") => {
    setCardState((s) => ({ ...s, [rec.title]: sentiment }));
    onFeedback(rec.title, rec.platform, sentiment);
  };

  const allCards: Recommendation[] = [results.main, ...results.alternatives];
  const visibleCards = allCards.filter((r) => cardState[r.title] !== "seen" && cardState[r.title] !== "dislike");
  const visibleMain = visibleCards[0] ?? null;
  const visibleAlts = visibleCards.slice(1);
  const allDismissed = visibleCards.length === 0;

  const chips = useMemo(() => {
    return [
      results.filters.time,
      results.filters.company,
      results.filters.mood,
      results.filters.type,
    ].filter(Boolean) as string[];
  }, [results]);

  const contextChip = useMemo(() => {
    const ctx = inferContext();
    const parts = [
      `${ctx.dayOfWeek} ${ctx.hour.toString().padStart(2, "0")}h`,
      ctx.season,
    ];
    if (weather) parts.push(weatherHintShort(weather));
    return parts.join(" · ");
  }, [weather]);

  return (
    <section className="animate-fade-in pt-4">
      <header className="mb-8 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            ¿Qué <span className="text-primary">vemos hoy</span>?
          </h1>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudSun className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">Para tu {contextChip}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isGuest && (
            <Link
              to="/moments"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 text-xs font-semibold text-foreground transition-smooth hover:border-primary hover:text-primary"
              title="Tus Momentos guardados"
            >
              <Bookmark className="h-3.5 w-3.5" />
              Momentos
              {existingMoments.length > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                  {existingMoments.length}
                </span>
              )}
            </Link>
          )}
          <button
            onClick={onOpenSetup}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card/60 text-muted-foreground transition-smooth hover:border-primary hover:text-primary"
            title="Configurar plataformas, ubicación y momentos"
            aria-label="Configuración"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Momentos guardados — grid 4 slots */}
      {!isGuest && (
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Bookmark className="h-3 w-3 text-primary" />
            Elegí tu Momento actual
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {existingMoments.slice(0, 3).map((m) => (
              <button
                key={m.id}
                onClick={() => onSearchFilters({
                  time: m.time_filter as SituationFilters["time"],
                  company: m.company_filter as SituationFilters["company"],
                  mood: m.mood_filter as SituationFilters["mood"],
                  type: m.type_filter as SituationFilters["type"],
                  attention: null,
                  novelty: null,
                  platforms: (m.platforms ?? currentFilters.platforms) as SituationFilters["platforms"],
                })}
                className="flex min-h-[64px] items-center justify-center gap-1.5 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-foreground transition-smooth hover:border-primary hover:bg-primary/10 active:scale-[0.98]"
                title={`Buscar para tu Momento "${m.name}"`}
              >
                <Bookmark className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
            <button
              onClick={() => setShowSaveModal(true)}
              className="flex min-h-[64px] items-center justify-center gap-1.5 rounded-2xl border border-dashed border-primary/40 bg-transparent px-3 py-2 text-xs font-semibold text-primary transition-smooth hover:border-primary hover:bg-primary/5 active:scale-[0.98]"
              title="Crear un nuevo Momento con los filtros actuales"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Crear Momento</span>
            </button>
          </div>
        </div>
      )}

      {/* 3 acciones rápidas */}
      <div className="mb-8 grid grid-cols-3 gap-2">
        <button
          onClick={onBack}
          className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border border-primary/40 bg-primary/10 px-2 text-[11px] font-semibold text-primary transition-smooth hover:bg-primary/20 active:scale-[0.98]"
          title="Sorprendeme con otra recomendación"
        >
          <RefreshCw className="h-4 w-4" />
          Proponeme otra cosa...
        </button>
        <button
          onClick={() => setTunePanel((p) => (p === "tune" ? "none" : "tune"))}
          className={cn(
            "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 text-[11px] font-semibold transition-smooth active:scale-[0.98]",
            tunePanel === "tune"
              ? "border-primary bg-primary/15 text-primary"
              : "border-border bg-card/60 text-foreground hover:border-primary/60",
          )}
          aria-expanded={tunePanel === "tune"}
        >
          <Sliders className="h-4 w-4" />
          Afinar
        </button>
        <button
          onClick={() => setTunePanel((p) => (p === "write" ? "none" : "write"))}
          className={cn(
            "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 text-[11px] font-semibold transition-smooth active:scale-[0.98]",
            tunePanel === "write"
              ? "border-primary bg-primary/15 text-primary"
              : "border-border bg-card/60 text-foreground hover:border-primary/60",
          )}
          aria-expanded={tunePanel === "write"}
        >
          <PenLine className="h-4 w-4" />
          Pedime lo que querés
        </button>
      </div>

      {/* Panel: Afinar */}
      {tunePanel === "tune" && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-card/70 p-4">
          <p className="mb-3 text-[11px] text-muted-foreground">
            Tocá uno o más chips. Si dejás vacío un grupo, lo decidimos por vos.
          </p>
          <div className="space-y-3">
            <QuickChips
              label="Tiempo"
              options={TIME_OPTIONS}
              value={tuneFilters.time}
              labelMap={TIME_LABELS}
              onSelect={(v) =>
                setTuneFilters({ ...tuneFilters, time: v as SituationFilters["time"] })
              }
            />
            <QuickChips
              label="Compañía"
              options={COMPANY_OPTIONS}
              value={tuneFilters.company}
              onSelect={(v) =>
                setTuneFilters({ ...tuneFilters, company: v as SituationFilters["company"] })
              }
            />
            <QuickChips
              label="Mood"
              options={MOOD_OPTIONS}
              value={tuneFilters.mood}
              onSelect={(v) =>
                setTuneFilters({ ...tuneFilters, mood: v as SituationFilters["mood"] })
              }
            />
            <QuickChips
              label="Tipo"
              options={TYPE_OPTIONS}
              value={tuneFilters.type}
              onSelect={(v) =>
                setTuneFilters({ ...tuneFilters, type: v as SituationFilters["type"] })
              }
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <button
              onClick={() => onSearchFilters(tuneFilters)}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 text-sm font-semibold text-primary-foreground shadow-primary transition-smooth active:scale-[0.98]"
            >
              <Sparkles className="h-4 w-4" />
              Recomendar con esto
            </button>
            {!isGuest && (
              <button
                onClick={() => {
                  onSearchFilters(tuneFilters);
                  setTimeout(() => setShowSaveModal(true), 250);
                }}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 text-xs font-semibold text-primary transition-smooth hover:bg-primary/20"
                title="Guardar esta combinación como un Momento reutilizable"
              >
                <Bookmark className="h-3.5 w-3.5" />
                Guardar como Momento
              </button>
            )}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Guardalo como Momento y aparece arriba como tarjeta para reusarlo de un toque.
          </p>
        </div>
      )}

      {/* Panel: Escribir */}
      {tunePanel === "write" && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-card/70 p-4">
          <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-primary">
            <PenLine className="mr-1 inline h-3 w-3" />
            Decime algo específico
          </label>
          <div className="rounded-xl border border-primary/30 bg-input-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
            <textarea
              value={tuneText}
              onChange={(e) => setTuneText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (tuneText.trim().length >= 3) onSearchText(tuneText.trim());
                }
              }}
              rows={2}
              autoFocus
              placeholder="Ej: algo de menos de una hora, sin pensar mucho…"
              className="w-full resize-none bg-transparent px-3 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <MicButton
                onTranscript={(t, isFinal) => {
                  if (!t || !isFinal) return;
                  setTuneText((prev) => (prev ? `${prev.trim()} ${t}` : t));
                }}
              />
              <button
                onClick={() => tuneText.trim().length >= 3 && onSearchText(tuneText.trim())}
                disabled={tuneText.trim().length < 3}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-smooth",
                  tuneText.trim().length >= 3
                    ? "bg-gradient-primary text-primary-foreground shadow-primary active:scale-95"
                    : "cursor-not-allowed bg-background text-muted-foreground",
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" /> Buscar
              </button>
            </div>
          </div>
        </div>
      )}

      {source === "text" && freeText && tunePanel !== "write" && (
        <div className="mb-3 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          Entendimos: <span className="text-foreground">"{freeText}"</span>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {results.clarification_needed && (
        <div className="mb-4 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground">
          {results.clarification_needed}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.2em] text-primary">
          {source === "moment" ? "Para tu Momento, te recomendamos" : "Te proponemos"}
        </div>
        {excludedCount > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Excluyendo {excludedCount} {excludedCount === 1 ? "ya vista" : "ya vistas"}
          </span>
        )}
      </div>

      {visibleMain && (
        <div className="mt-2 grid grid-cols-1 items-start gap-5 md:grid-cols-3 md:items-center md:gap-6">
          <div className="order-2 md:order-1">
            {visibleAlts[0] && (
              <AltCard
                key={visibleAlts[0].title}
                rec={visibleAlts[0]}
                posterUrl={posters[visibleAlts[0].title] ?? null}
                posterLoading={postersLoading && !(visibleAlts[0].title in posters)}
                feedback={cardState[visibleAlts[0].title] ?? null}
                onSeen={() => markSeen(visibleAlts[0])}
                onLike={() => markFeedback(visibleAlts[0], "like")}
                onLove={() => markFeedback(visibleAlts[0], "love")}
                onDislike={() => markFeedback(visibleAlts[0], "dislike")}
                allowFeedback={!isGuestForFeedback}
              />
            )}
          </div>

          <div className="order-1 md:order-2 md:scale-[1.04] md:z-10">
            <MainCard
              rec={visibleMain}
              posterUrl={posters[visibleMain.title] ?? null}
              posterLoading={postersLoading && !(visibleMain.title in posters)}
              feedback={cardState[visibleMain.title] ?? null}
              onSeen={() => markSeen(visibleMain)}
              onLike={() => markFeedback(visibleMain, "like")}
              onLove={() => markFeedback(visibleMain, "love")}
              onDislike={() => markFeedback(visibleMain, "dislike")}
              allowFeedback={!isGuestForFeedback}
            />
          </div>

          <div className="order-3 md:order-3">
            {visibleAlts[1] && (
              <AltCard
                key={visibleAlts[1].title}
                rec={visibleAlts[1]}
                posterUrl={posters[visibleAlts[1].title] ?? null}
                posterLoading={postersLoading && !(visibleAlts[1].title in posters)}
                feedback={cardState[visibleAlts[1].title] ?? null}
                onSeen={() => markSeen(visibleAlts[1])}
                onLike={() => markFeedback(visibleAlts[1], "like")}
                onLove={() => markFeedback(visibleAlts[1], "love")}
                onDislike={() => markFeedback(visibleAlts[1], "dislike")}
                allowFeedback={!isGuestForFeedback}
              />
            )}
          </div>
        </div>
      )}

      {visibleAlts.length > 2 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            O si no…
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visibleAlts.slice(2).map((r) => (
              <AltCard
                key={r.title}
                rec={r}
                posterUrl={posters[r.title] ?? null}
                posterLoading={postersLoading && !(r.title in posters)}
                feedback={cardState[r.title] ?? null}
                onSeen={() => markSeen(r)}
                onLike={() => markFeedback(r, "like")}
                onLove={() => markFeedback(r, "love")}
                onDislike={() => markFeedback(r, "dislike")}
                allowFeedback={!isGuestForFeedback}
              />
            ))}
          </div>
        </div>
      )}

      {allDismissed && (
        <div className="flex flex-col items-center gap-4 py-16 text-center animate-fade-in">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/30">
            <Film className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <div>
            <p className="font-display text-xl font-bold text-foreground">Nada quedó en pie</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Descartaste todo — buscamos algo distinto.
            </p>
          </div>
        </div>
      )}

      {(Object.keys(cardState).length > 0 || allDismissed) && (
        <button
          onClick={onRerunExcludingSeen}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-5 text-sm font-semibold text-primary transition-smooth hover:bg-primary/20"
        >
          <RefreshCw className="h-4 w-4" />
          {allDismissed ? "Buscar otras opciones" : "Buscar más, excluyendo lo marcado"}
        </button>
      )}

      {source !== "moment" && !savedOnce && !isGuest && (
        <button
          onClick={() => setShowSaveModal(true)}
          className="mt-8 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card/60 px-4 text-sm font-medium text-foreground transition-smooth hover:border-primary"
        >
          <Bookmark className="h-4 w-4" /> Guardar como Momento
        </button>
      )}
      {source !== "moment" && isGuest && (
        <Link
          to="/login"
          className="mt-8 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-dashed border-border bg-transparent px-4 text-sm font-medium text-muted-foreground transition-smooth hover:border-primary hover:text-primary"
        >
          <Bookmark className="h-4 w-4" /> Iniciá sesión para guardar este Momento
        </Link>
      )}
      {savedOnce && (
        <div className="mt-8 inline-flex items-center gap-2 text-sm text-primary">
          <Check className="h-4 w-4" /> Guardado en tus Momentos
        </div>
      )}

      {showPattern &&
        patternSuggestion &&
        existingMoments.length < 12 &&
        !savedOnce && (
          <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/10 p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm text-foreground">
                Notamos que repetís esta combinación ({patternSuggestion.count} veces).
                ¿La guardás como Momento?
              </p>
              <button
                onClick={() => setShowPattern(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Descartar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => {
                setShowSaveModal(true);
                setShowPattern(false);
              }}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Crear Momento →
            </button>
          </div>
        )}

      {showSaveModal && (
        <SaveMomentModal
          defaultName={suggestNameFromFilters(results.filters)}
          onClose={() => setShowSaveModal(false)}
          onSave={async (name) => {
            setSaving(true);
            try {
              await onSaveMoment(name);
              setSavedOnce(true);
              setShowSaveModal(false);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
        />
      )}
    </section>
  );
}

function suggestNameFromFilters(f: RecommendationsResult["filters"]): string {
  const parts = [f.time, f.company, f.mood, f.type].filter(Boolean) as string[];
  return parts.slice(0, 3).join(" · ") || "Mi Momento";
}

function SaveMomentModal({
  defaultName,
  onClose,
  onSave,
  saving,
}: {
  defaultName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-6 pt-20 sm:items-center sm:pb-0"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-foreground">Nombrá tu Momento</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ej: &quot;Martes noche, serie solo&quot;, &quot;Finde con María&quot;.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 min-h-[48px] w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-background"
          >
            Cancelar
          </button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            disabled={saving || !name.trim()}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 text-sm font-semibold text-primary-foreground shadow-primary disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = colorForPlatform(platform);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white"
      style={{ background: color }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
      {platform}
    </span>
  );
}

type CardFeedback = "seen" | "like" | "love" | "dislike" | null;

function MainCard({
  rec,
  posterUrl,
  posterLoading = false,
  feedback,
  onSeen,
  onLike,
  onLove,
  onDislike,
  allowFeedback,
}: {
  rec: Recommendation;
  posterUrl: string | null;
  posterLoading?: boolean;
  feedback: CardFeedback;
  onSeen: () => void;
  onLike: () => void;
  onLove: () => void;
  onDislike: () => void;
  allowFeedback: boolean;
}) {
  return (
    <article className="relative overflow-hidden rounded-[2rem] border-2 border-primary/50 bg-card shadow-glow">
      <div className="absolute left-4 top-4 z-20">
        <span className="rounded-lg bg-primary px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary-foreground shadow-lg">
          Recomendado
        </span>
      </div>

      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted/40">
        {posterLoading && !posterUrl ? (
          <div className="h-full w-full animate-pulse bg-muted/40" />
        ) : posterUrl ? (
          <img
            src={posterUrl}
            alt={`Portada de ${rec.title}`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center"
            style={{
              background: `linear-gradient(135deg, ${colorForPlatform(rec.platform)}33, ${colorForPlatform(rec.platform)}11)`,
            }}
          >
            <Film className="h-12 w-12 text-foreground/40" />
            <span className="text-sm font-semibold text-foreground/70 line-clamp-3">
              {rec.title}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-card via-card/85 to-transparent" />
      </div>

      <div className="relative -mt-12 px-6 pb-6 pt-2">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            {rec.platform} · {rec.type}
          </span>
          <span className="text-[11px] text-muted-foreground">· {rec.duration}</span>
        </div>
        <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground">
          {rec.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/80">{rec.reason}</p>

        <a
          href={deepLinkFor(rec.platform, rec.title)}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary px-6 text-sm font-bold text-primary-foreground shadow-primary transition-smooth hover:brightness-110 active:scale-[0.98]"
        >
          <Play className="h-4 w-4 fill-current" />
          Ver ahora en {rec.platform}
        </a>

        <div className="mt-5 border-t border-border/50 pt-4">
          <IconFeedbackRow
            feedback={feedback}
            onSeen={onSeen}
            onLike={onLike}
            onLove={onLove}
            onDislike={onDislike}
            allowFeedback={allowFeedback}
          />
        </div>
      </div>
    </article>
  );
}

function AltCard({
  rec,
  posterUrl,
  posterLoading = false,
  feedback,
  onSeen,
  onLike,
  onLove,
  onDislike,
  allowFeedback,
}: {
  rec: Recommendation;
  posterUrl: string | null;
  posterLoading?: boolean;
  feedback: CardFeedback;
  onSeen: () => void;
  onLike: () => void;
  onLove: () => void;
  onDislike: () => void;
  allowFeedback: boolean;
}) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-border bg-card/40 transition-smooth hover:bg-card/70">
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted/40">
        {posterLoading && !posterUrl ? (
          <div className="h-full w-full animate-pulse bg-muted/40" />
        ) : posterUrl ? (
          <img
            src={posterUrl}
            alt={`Portada de ${rec.title}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center"
            style={{
              background: `linear-gradient(135deg, ${colorForPlatform(rec.platform)}33, ${colorForPlatform(rec.platform)}11)`,
            }}
          >
            <Film className="h-10 w-10 text-foreground/40" />
            <span className="text-sm font-semibold text-foreground/70 line-clamp-2">
              {rec.title}
            </span>
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {rec.platform} · {rec.duration}
        </div>
        <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-foreground">
          {rec.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground/65">
          {rec.reason}
        </p>

        <a
          href={deepLinkFor(rec.platform, rec.title)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 text-xs font-bold uppercase tracking-wider text-foreground transition-smooth hover:border-primary hover:text-primary"
        >
          <Play className="h-3 w-3 fill-current" />
          Ver ahora
        </a>

        <div className="mt-4 border-t border-border/40 pt-3">
          <IconFeedbackRow
            feedback={feedback}
            onSeen={onSeen}
            onLike={onLike}
            onLove={onLove}
            onDislike={onDislike}
            allowFeedback={allowFeedback}
            compact
          />
        </div>
      </div>
    </article>
  );
}

function IconFeedbackRow({
  feedback,
  onSeen,
  onLike,
  onLove,
  onDislike,
  allowFeedback,
  compact = false,
}: {
  feedback: CardFeedback;
  onSeen: () => void;
  onLike: () => void;
  onLove: () => void;
  onDislike: () => void;
  allowFeedback: boolean;
  compact?: boolean;
}) {
  if (feedback === "like" || feedback === "love") {
    return (
      <div className="flex items-center justify-center gap-2 text-xs font-semibold text-primary">
        <Heart className={cn("h-4 w-4", feedback === "love" && "fill-current")} />
        {feedback === "love" ? "Te encanta — lo recordamos" : "Te gusta — lo recordamos"}
      </div>
    );
  }

  const btnSize = compact ? "p-2" : "p-2.5";
  const iconSize = compact ? "h-4 w-4" : "h-5 w-5";
  const labelSize = compact ? "text-[9px]" : "text-[10px]";

  return (
    <div className="flex items-start justify-around gap-2">
      {allowFeedback && (
        <>
          <button
            onClick={onLove}
            title="Me encanta"
            className="group/btn flex flex-col items-center gap-1"
          >
            <div className={cn("rounded-full bg-muted/50 transition-colors group-hover/btn:bg-primary/15", btnSize)}>
              <Heart className={cn(iconSize, "text-muted-foreground transition-colors group-hover/btn:text-primary")} />
            </div>
            <span className={cn("font-bold uppercase tracking-wider text-muted-foreground transition-colors group-hover/btn:text-primary", labelSize)}>
              Amo
            </span>
          </button>
          <button
            onClick={onLike}
            title="Me gusta"
            className="group/btn flex flex-col items-center gap-1"
          >
            <div className={cn("rounded-full bg-muted/50 transition-colors group-hover/btn:bg-primary/15", btnSize)}>
              <ThumbsUp className={cn(iconSize, "text-muted-foreground transition-colors group-hover/btn:text-primary")} />
            </div>
            <span className={cn("font-bold uppercase tracking-wider text-muted-foreground transition-colors group-hover/btn:text-primary", labelSize)}>
              Va
            </span>
          </button>
          <button
            onClick={onDislike}
            title="No me gusta"
            className="group/btn flex flex-col items-center gap-1"
          >
            <div className={cn("rounded-full bg-muted/50 transition-colors group-hover/btn:bg-destructive/15", btnSize)}>
              <ThumbsDown className={cn(iconSize, "text-muted-foreground transition-colors group-hover/btn:text-destructive")} />
            </div>
            <span className={cn("font-bold uppercase tracking-wider text-muted-foreground transition-colors group-hover/btn:text-destructive", labelSize)}>
              No
            </span>
          </button>
        </>
      )}
      <button
        onClick={onSeen}
        title="Ya la vi"
        className="group/btn flex flex-col items-center gap-1"
      >
        <div className={cn("rounded-full bg-muted/50 transition-colors group-hover/btn:bg-foreground/10", btnSize)}>
          <EyeOff className={cn(iconSize, "text-muted-foreground transition-colors group-hover/btn:text-foreground")} />
        </div>
        <span className={cn("font-bold uppercase tracking-wider text-muted-foreground transition-colors group-hover/btn:text-foreground", labelSize)}>
          Vista
        </span>
      </button>
    </div>
  );
}

// Suppress unused variable warning — PlatformBadge kept for potential future use
void PlatformBadge;
