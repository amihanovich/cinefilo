import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ArrowUp,
  ThumbsUp,
  ThumbsDown,
  Heart,
  EyeOff,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  MapPin,
} from "lucide-react";
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
import { fetchPostersClient } from "@/lib/itunes";
import {
  readGuestSeed,
  seedForServer,
  bumpSearchCount,
  dismissLoginNudge,
} from "@/lib/guestSeed";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  data?: RecommendationsResult;
  feedbackGiven?: Record<string, "love" | "like" | "dislike" | "seen">;
};

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
      // First message: minimum 1.5s on home so the orb stays visible while thinking
      const apiPromise = recommendConversational({
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
      const delayPromise = isFirstMessage
        ? new Promise<void>((r) => setTimeout(r, 1500))
        : Promise.resolve();
      const [data] = await Promise.all([apiPromise, delayPromise]);

      const aiMsg: ChatMessage = { id: uid(), role: "assistant", text: "", data, feedbackGiven: {} };

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
    sentiment: "love" | "like" | "dislike" | "seen",
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, feedbackGiven: { ...(m.feedbackGiven ?? {}), [title]: sentiment } }
          : m,
      ),
    );
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
          inputText={inputText}
          posters={posters}
          onInputChange={setInputText}
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
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (text.trim().length >= 2) onSubmit(text.trim());
  };

  const togglePlatform = (p: Platform) => {
    const has = selectedPlatforms.includes(p);
    onSelectedPlatformsChange(has ? selectedPlatforms.filter((x) => x !== p) : [...selectedPlatforms, p]);
  };

  return (
    <section className="relative flex min-h-[calc(100vh-57px)] flex-col items-center justify-center overflow-hidden px-6 py-12 animate-fade-in">
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute left-1/2 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/3 rounded-full"
          style={{ background: "radial-gradient(circle, oklch(0.51 0.22 277 / 0.06) 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full"
          style={{ background: "radial-gradient(circle, oklch(0.60 0.18 290 / 0.04) 0%, transparent 70%)" }}
        />
      </div>

      {/* Login nudge */}
      {showLoginNudge && (
        <div className="absolute top-4 left-1/2 z-20 w-full max-w-sm -translate-x-1/2 px-4 animate-fade-in">
          <div className="rounded-2xl border border-primary/25 bg-white/90 p-4 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Guardá tu perfil</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Creá tu cuenta para guardar plataformas y preferencias.
                </p>
                <div className="mt-2 flex gap-2">
                  <Link to="/login" className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                    Crear cuenta →
                  </Link>
                  <button onClick={onDismissLoginNudge} className="text-xs text-muted-foreground hover:text-foreground">Ahora no</button>
                </div>
              </div>
              <button onClick={onDismissLoginNudge} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Center content */}
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center">
        {/* Orb */}
        <VoiceOrb
          onFinalTranscript={(t) => onSubmit(t)}
          disabled={isLoading}
        />

        {/* Headline */}
        <h1 className="mt-8 font-serif text-4xl font-bold leading-tight text-foreground sm:text-5xl">
          ¿Qué querés ver esta noche?
        </h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Buscando algo perfecto…
            </span>
          ) : (
            "Hablame o escribime lo que querés ver"
          )}
        </p>

        {/* Text input bar */}
        <div className="mt-8 w-full">
          <div className={cn(
            "flex items-center gap-2 rounded-2xl border border-border bg-white/80 px-4 py-3 backdrop-blur-sm transition-all",
            "focus-within:border-primary/50 focus-within:bg-white/90",
          )}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="o escribí acá…"
              disabled={isLoading}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50"
            />
            <MicButton
              onTranscript={(t, isFinal) => {
                if (!t || !isFinal) return;
                setText((prev) => (prev ? `${prev.trim()} ${t}` : t));
                inputRef.current?.focus();
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={text.trim().length < 2 || isLoading}
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-smooth",
                text.trim().length >= 2 && !isLoading
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground/40 cursor-not-allowed",
              )}
              aria-label="Buscar"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Settings toggle */}
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="mt-4 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          {showSettings ? "Ocultar ajustes ↑" : "Ajustes de plataformas y ubicación ↓"}
        </button>

        {showSettings && (
          <div className="mt-4 w-full space-y-3 animate-fade-in">
            {/* Platform chips */}
            <div className="rounded-2xl border border-border bg-white/70 p-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Plataformas
                </span>
                {selectedPlatforms.length > 0 &&
                  JSON.stringify([...selectedPlatforms].sort()) !== JSON.stringify([...defaultPlatforms].sort()) && (
                    <button onClick={() => onSaveDefaultPlatforms(selectedPlatforms)} className="text-[11px] text-primary hover:underline">
                      Guardar
                    </button>
                  )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(PLATFORM_OPTIONS as Platform[]).map((p) => {
                  const active = selectedPlatforms.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePlatform(p)}
                      style={active ? { borderColor: colorForPlatform(p), background: `${colorForPlatform(p)}22` } : undefined}
                      className={cn(
                        "inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-smooth",
                        active ? "text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForPlatform(p) }} />
                      {p}
                    </button>
                  );
                })}
              </div>
              {selectedPlatforms.length === 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground/60">Todas las plataformas.</p>
              )}
            </div>

            {/* Location toggle */}
            <div className="flex items-center justify-between rounded-2xl border border-border bg-white/70 px-3 py-2.5 backdrop-blur-sm">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <MapPin className="h-3 w-3 text-primary" />
                  Usar ubicación
                </div>
                {useLocation && weatherLoading && <p className="mt-0.5 text-[11px] text-muted-foreground">Leyendo clima…</p>}
                {useLocation && !weatherLoading && weather && <p className="mt-0.5 text-[11px] text-primary">{weatherHintShort(weather)}</p>}
                {useLocation && !weatherLoading && !weather && <p className="mt-0.5 text-[11px] text-destructive">Sin acceso al clima.</p>}
                {!useLocation && <p className="mt-0.5 text-[11px] text-muted-foreground/60">Suma el clima al contexto.</p>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={useLocation}
                onClick={() => onToggleLocation(!useLocation)}
                className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", useLocation ? "bg-primary" : "bg-border")}
              >
                <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform", useLocation ? "translate-x-4" : "translate-x-0.5")} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ===================== CHAT ===================== */

function ChatScreen({
  messages,
  isLoading,
  isGuest,
  inputText,
  posters,
  onInputChange,
  onSubmit,
  onFeedback,
  onNewSearch,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  isGuest: boolean;
  inputText: string;
  posters: Record<string, string | null>;
  onInputChange: (v: string) => void;
  onSubmit: (text: string) => void;
  onFeedback: (msgId: string, title: string, platform: string, sentiment: "love" | "like" | "dislike" | "seen") => void;
  onNewSearch: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = () => {
    if (inputText.trim().length >= 2) onSubmit(inputText.trim());
  };

  return (
    <section className="mx-auto flex max-w-2xl flex-col px-4 pb-6 pt-6 sm:px-6 animate-fade-in">
      {/* Chat window */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
            <span className="h-3 w-3 rounded-full bg-green-500/70" />
            <span className="ml-2 text-xs font-semibold text-muted-foreground">Cinéfilo</span>
          </div>
          <button
            onClick={onNewSearch}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            Nueva búsqueda
          </button>
        </div>

        {/* Messages */}
        <div className="max-h-[65vh] overflow-y-auto px-5 py-5">
          <div className="space-y-5">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <UserBubble key={msg.id} text={msg.text} />
              ) : (
                <AssistantBubble
                  key={msg.id}
                  msg={msg}
                  isGuest={isGuest}
                  posters={posters}
                  onFeedback={(title, platform, sentiment) =>
                    onFeedback(msg.id, title, platform, sentiment)
                  }
                />
              ),
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Buscando algo perfecto…
              </div>
            )}
          </div>
          <div ref={endRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
          }}
          rows={1}
          placeholder="Seguí pidiendo… algo más oscuro, solo Netflix…"
          className="w-full resize-none bg-transparent px-5 pb-2 pt-4 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          style={{ maxHeight: "100px" }}
        />
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <MicButton
            onTranscript={(t, isFinal) => {
              if (!t || !isFinal) return;
              onInputChange(inputText ? `${inputText.trim()} ${t}` : t);
              inputRef.current?.focus();
            }}
            className="text-muted-foreground hover:text-foreground"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={inputText.trim().length < 2 || isLoading}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full transition-smooth",
              inputText.trim().length >= 2 && !isLoading
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground/40 cursor-not-allowed",
            )}
            aria-label="Enviar"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isGuest && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          ¿Querés guardar tu historial?{" "}
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
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-foreground px-4 py-3">
        <p className="text-sm leading-relaxed text-background">{text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({
  msg,
  isGuest,
  posters,
  onFeedback,
}: {
  msg: ChatMessage;
  isGuest: boolean;
  posters: Record<string, string | null>;
  onFeedback: (title: string, platform: string, sentiment: "love" | "like" | "dislike" | "seen") => void;
}) {
  const { data } = msg;
  if (!data) return null;
  const { main, alternatives } = data;
  const mainFeedback = msg.feedbackGiven?.[main.title] ?? null;
  const mainPoster = posters[main.title];

  return (
    <div className="flex flex-col gap-3">
      {/* Main recommendation — WhatsApp-style visual card */}
      <div className="max-w-[90%] overflow-hidden rounded-2xl rounded-tl-sm border border-border bg-white shadow-sm">
        <div className="flex">
          {/* Poster / color block */}
          <div
            className="relative h-[170px] w-[113px] shrink-0 overflow-hidden"
            style={!mainPoster ? { background: `${colorForPlatform(main.platform)}18` } : undefined}
          >
            {mainPoster ? (
              <img
                src={mainPoster}
                alt={main.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2">
                <span
                  className="text-2xl font-black opacity-20"
                  style={{ color: colorForPlatform(main.platform) }}
                >
                  {main.title.charAt(0)}
                </span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex flex-1 flex-col justify-between p-4">
            <div>
              {/* Platform badge */}
              <div className="mb-2 flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: colorForPlatform(main.platform) }}
                />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: colorForPlatform(main.platform) }}
                >
                  {main.platform}
                </span>
              </div>

              <h3 className="text-sm font-bold leading-tight text-foreground">{main.title}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {main.duration} · {main.type}
              </p>
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-foreground/70">
                {main.reason}
              </p>
            </div>

            <a
              href={deepLinkFor(main.platform, main.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: colorForPlatform(main.platform) }}
            >
              <ExternalLink className="h-3 w-3" />
              Ver en {main.platform}
            </a>
          </div>
        </div>

        {/* Feedback */}
        {!isGuest && (
          <div className="border-t border-border/60 px-4 py-2.5">
            <FeedbackRow
              feedback={mainFeedback}
              onLove={() => onFeedback(main.title, main.platform, "love")}
              onLike={() => onFeedback(main.title, main.platform, "like")}
              onDislike={() => onFeedback(main.title, main.platform, "dislike")}
              onSeen={() => onFeedback(main.title, main.platform, "seen")}
            />
          </div>
        )}
      </div>

      {/* Alternatives — horizontal scroll carousel */}
      {alternatives.length > 0 && (
        <div className="max-w-[90%]">
          <p className="mb-2 text-[11px] text-muted-foreground">También podría ser…</p>
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {alternatives.map((alt, i) => {
              const altPoster = posters[alt.title];
              const altFeedback = msg.feedbackGiven?.[alt.title] ?? null;
              return (
                <div
                  key={alt.title}
                  className={cn(
                    "flex-none w-[130px] overflow-hidden rounded-xl border border-border bg-white shadow-sm",
                    i >= 2 && "hidden sm:flex sm:flex-col",
                  )}
                >
                  {/* Mini poster or platform color block */}
                  <div
                    className="h-[80px] overflow-hidden"
                    style={!altPoster ? { background: `${colorForPlatform(alt.platform)}15` } : undefined}
                  >
                    {altPoster ? (
                      <img
                        src={altPoster}
                        alt={alt.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <span
                          className="text-xs font-black opacity-25"
                          style={{ color: colorForPlatform(alt.platform) }}
                        >
                          {alt.title.charAt(0)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground">
                      {alt.title}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: colorForPlatform(alt.platform) }}
                      />
                      <span className="text-[10px] text-muted-foreground">{alt.platform}</span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <a
                        href={deepLinkFor(alt.platform, alt.title)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Ver →
                      </a>
                      {!isGuest && (
                        <CompactFeedback
                          feedback={altFeedback}
                          onLike={() => onFeedback(alt.title, alt.platform, "like")}
                          onDislike={() => onFeedback(alt.title, alt.platform, "dislike")}
                          onSeen={() => onFeedback(alt.title, alt.platform, "seen")}
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

function FeedbackRow({ feedback, onLove, onLike, onDislike, onSeen }: {
  feedback: "love" | "like" | "dislike" | "seen" | null;
  onLove: () => void; onLike: () => void; onDislike: () => void; onSeen: () => void;
}) {
  if (feedback === "love") return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
      <Heart className="h-3.5 w-3.5 fill-current" />¡Te encanta! Lo recordamos.
    </div>
  );
  if (feedback === "like") return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
      <ThumbsUp className="h-3.5 w-3.5" />Te gusta. Lo recordamos.
    </div>
  );
  if (feedback === "dislike" || feedback === "seen") return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AlertTriangle className="h-3.5 w-3.5" />
      {feedback === "seen" ? "Marcado como ya vista." : "Descartado."}
    </div>
  );
  return (
    <div className="flex items-center gap-3">
      {([
        { label: "Amo", icon: Heart, action: onLove, hover: "hover:text-primary" },
        { label: "Va", icon: ThumbsUp, action: onLike, hover: "hover:text-primary" },
        { label: "No", icon: ThumbsDown, action: onDislike, hover: "hover:text-destructive" },
        { label: "Ya la vi", icon: EyeOff, action: onSeen, hover: "hover:text-foreground" },
      ] as const).map(({ label, icon: Icon, action, hover }) => (
        <button key={label} onClick={action}
          className={cn("group flex items-center gap-1 text-xs text-muted-foreground transition-colors", hover)}>
          <Icon className="h-3.5 w-3.5" />{label}
        </button>
      ))}
    </div>
  );
}

function CompactFeedback({ feedback, onLike, onDislike, onSeen }: {
  feedback: "love" | "like" | "dislike" | "seen" | null;
  onLike: () => void; onDislike: () => void; onSeen: () => void;
}) {
  if (feedback) return <span className="text-[11px] text-muted-foreground">{feedback === "like" || feedback === "love" ? "✓" : "✗"}</span>;
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onLike} className="text-muted-foreground hover:text-primary" title="Me gusta"><ThumbsUp className="h-3 w-3" /></button>
      <button onClick={onDislike} className="text-muted-foreground hover:text-destructive" title="No me gusta"><ThumbsDown className="h-3 w-3" /></button>
      <button onClick={onSeen} className="text-muted-foreground hover:text-foreground" title="Ya la vi"><EyeOff className="h-3 w-3" /></button>
    </div>
  );
}
