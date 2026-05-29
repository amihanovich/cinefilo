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
  Mic,
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
import { Onboarding } from "@/components/Onboarding";
import {
  readGuestSeed,
  seedForServer,
  isOnboarded,
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

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!sessionReady || !isGuest) return;
    if (isOnboarded()) return;
    setShowOnboarding(true);
  }, [sessionReady, isGuest]);

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
    const w = await getWeatherSnapshot();
    setWeather(w);
    setWeatherLoading(false);
  };

  useEffect(() => {
    const handler = () => { setStep("home"); setMessages([]); setInputText(""); setExcluded([]); };
    window.addEventListener("que-veo:go-home", handler);
    return () => window.removeEventListener("que-veo:go-home", handler);
  }, []);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;

    const userMsg: ChatMessage = { id: uid(), role: "user", text: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText("");
    setIsLoading(true);
    if (step === "home") setStep("chat");

    const ctx = inferContext();
    const contextHint = contextToPromptHint(ctx);
    const seasonHint = seasonHintShort(ctx);
    const weatherHint = weather ? weatherHintShort(weather) : null;

    // Build conversation history for AI: assistant messages summarized as titles
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
          contextHint,
          seasonHint,
          weatherHint,
          excludeTitles: excluded,
          profileSeed: isGuest ? seedForServer(readGuestSeed()) : undefined,
        },
      });

      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: "",
        data,
        feedbackGiven: {},
      };
      setMessages((prev) => [...prev, aiMsg]);

      // Track recommended titles to avoid repeating
      const newExcluded = [data.main.title, ...data.alternatives.map((a) => a.title)];
      setExcluded((prev) => [...prev, ...newExcluded.filter((t) => !prev.includes(t))]);

      if (isGuest) {
        bumpSearchCount();
        setGuestSeedVersion((v) => v + 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Algo salió mal.";
      toast.error(msg, { duration: 6000 });
      setMessages(nextMessages.slice(0, -1)); // revert user message
      if (step === "home" && nextMessages.length === 1) setStep("home");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedbackInMessage = (
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
    <main className="min-h-[calc(100vh-65px)]">
      {showOnboarding && (
        <Onboarding
          onDone={() => {
            setShowOnboarding(false);
            setGuestSeedVersion((v) => v + 1);
          }}
        />
      )}

      {step === "home" && (
        <HomeScreen
          onSubmit={submit}
          defaultPlatforms={defaultPlatforms}
          selectedPlatforms={selectedPlatforms}
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
          onInputChange={setInputText}
          onSubmit={submit}
          onFeedback={handleFeedbackInMessage}
          onNewSearch={() => { setStep("home"); setMessages([]); setInputText(""); setExcluded([]); }}
        />
      )}
    </main>
  );
}

/* ===================== HOME SCREEN ===================== */

const FLOATING_PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+"];

function HomeScreen({
  onSubmit,
  defaultPlatforms,
  selectedPlatforms,
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
  defaultPlatforms: Platform[];
  selectedPlatforms: Platform[];
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (text.trim().length >= 2) onSubmit(text.trim());
  };

  const togglePlatform = (p: Platform) => {
    const has = selectedPlatforms.includes(p);
    onSelectedPlatformsChange(has ? selectedPlatforms.filter((x) => x !== p) : [...selectedPlatforms, p]);
  };

  return (
    <section className="flex flex-col items-center px-6 pb-16 pt-16 sm:px-8 animate-fade-in">
      {/* Login nudge */}
      {showLoginNudge && (
        <div className="mb-8 w-full max-w-xl rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Guardá tu perfil de gusto</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Creá tu cuenta para que tus plataformas y preferencias te sigan en cualquier dispositivo.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  to="/login"
                  className="inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Crear cuenta gratis →
                </Link>
                <button onClick={onDismissLoginNudge} className="text-xs text-muted-foreground hover:text-foreground">
                  Ahora no
                </button>
              </div>
            </div>
            <button onClick={onDismissLoginNudge} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="w-full max-w-2xl text-center">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
          <span className="text-primary">✦</span>
          Descubrí tu próxima película con IA
        </div>

        <h1 className="mb-4 font-serif text-5xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          ¿Qué querés ver hoy?
        </h1>
        <p className="mb-10 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Describilo con tus palabras. Te encontramos lo perfecto en todas tus plataformas.
        </p>

        {/* Input card with floating platforms */}
        <div className="relative">
          {/* Floating platform chips — desktop */}
          {FLOATING_PLATFORMS.slice(0, 2).map((p, i) => (
            <div
              key={p}
              className="pointer-events-none absolute hidden select-none lg:flex"
              style={{
                left: i === 0 ? "-9rem" : "-6.5rem",
                top: i === 0 ? "20%" : "58%",
              }}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3.5 py-2 text-sm font-semibold shadow-float">
                <span className="h-2 w-2 rounded-full" style={{ background: colorForPlatform(p) }} />
                {p}
              </span>
            </div>
          ))}
          {FLOATING_PLATFORMS.slice(2).map((p, i) => (
            <div
              key={p}
              className="pointer-events-none absolute hidden select-none lg:flex"
              style={{
                right: i === 0 ? "-8.5rem" : i === 1 ? "-7rem" : "-9.5rem",
                top: i === 0 ? "15%" : i === 1 ? "50%" : "78%",
              }}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3.5 py-2 text-sm font-semibold shadow-float">
                <span className="h-2 w-2 rounded-full" style={{ background: colorForPlatform(p) }} />
                {p === "Prime Video" ? "Prime" : p}
              </span>
            </div>
          ))}

          {/* Main input card */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-white shadow-float">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={2}
              placeholder="una película de acción para ver esta noche..."
              className="w-full resize-none bg-transparent px-5 pb-2 pt-5 text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <MicButton
                  onTranscript={(t, isFinal) => {
                    if (!t || !isFinal) return;
                    setText((prev) => (prev ? `${prev.trim()} ${t}` : t));
                    textareaRef.current?.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground"
                />
                <span className="text-xs text-muted-foreground/60">
                  Funciona con Netflix, Prime, Disney+ y más
                </span>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={text.trim().length < 2}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full transition-smooth",
                  text.trim().length >= 2
                    ? "bg-foreground text-background hover:bg-foreground/85"
                    : "bg-muted text-muted-foreground/40 cursor-not-allowed",
                )}
                aria-label="Buscar"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Gratis{isGuest ? " — sin cuenta necesaria" : ""}
        </p>
      </div>

      {/* Settings: platforms + location */}
      <div className="mt-10 w-full max-w-xl space-y-4">
        {/* Platform selector */}
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              ¿Dónde buscamos?
            </span>
            {selectedPlatforms.length > 0 &&
              JSON.stringify([...selectedPlatforms].sort()) !==
                JSON.stringify([...defaultPlatforms].sort()) && (
                <button
                  onClick={() => onSaveDefaultPlatforms(selectedPlatforms)}
                  className="text-[11px] text-primary hover:underline"
                >
                  Guardar como predeterminadas
                </button>
              )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(PLATFORM_OPTIONS as Platform[]).map((p) => {
              const active = selectedPlatforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  style={active ? { borderColor: colorForPlatform(p), background: `${colorForPlatform(p)}18` } : undefined}
                  className={cn(
                    "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-smooth",
                    active ? "text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForPlatform(p) }} />
                  {p === "Star+" ? "Star+ (Disney+)" : p}
                </button>
              );
            })}
          </div>
          {selectedPlatforms.length === 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Buscamos en todas las plataformas.
            </p>
          )}
        </div>

        {/* Location toggle */}
        <div className="flex items-center justify-between rounded-2xl border border-border bg-white px-4 py-3 shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-3 w-3 text-primary" />
              Usar mi ubicación
            </div>
            {useLocation && weatherLoading && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">Leyendo clima…</p>
            )}
            {useLocation && !weatherLoading && weather && (
              <p className="mt-0.5 text-[11px] text-primary">{weatherHintShort(weather)}</p>
            )}
            {useLocation && !weatherLoading && !weather && (
              <p className="mt-0.5 text-[11px] text-destructive">No pudimos leer el clima.</p>
            )}
            {!useLocation && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Suma el clima actual al contexto.
              </p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useLocation}
            onClick={() => onToggleLocation(!useLocation)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
              useLocation ? "bg-primary" : "bg-border",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
                useLocation ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ===================== CHAT SCREEN ===================== */

function ChatScreen({
  messages,
  isLoading,
  isGuest,
  inputText,
  onInputChange,
  onSubmit,
  onFeedback,
  onNewSearch,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  isGuest: boolean;
  inputText: string;
  onInputChange: (v: string) => void;
  onSubmit: (text: string) => void;
  onFeedback: (msgId: string, title: string, platform: string, sentiment: "love" | "like" | "dislike" | "seen") => void;
  onNewSearch: () => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = () => {
    if (inputText.trim().length >= 2) onSubmit(inputText.trim());
  };

  return (
    <section className="mx-auto flex max-w-2xl flex-col px-4 pb-6 pt-6 sm:px-6 animate-fade-in">
      {/* Chat window */}
      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-card">
        {/* Window header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
            <span className="ml-2 text-xs font-semibold text-muted-foreground">CineAI</span>
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
                  onFeedback={(title, platform, sentiment) =>
                    onFeedback(msg.id, title, platform, sentiment)
                  }
                />
              ),
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Buscando algo perfecto…</span>
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-white shadow-card">
        <div className="relative flex items-end">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={1}
            placeholder="Seguí pidiendo… algo más oscuro, solo Netflix…"
            className="w-full resize-none bg-transparent px-5 pb-3 pt-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            style={{ maxHeight: "120px" }}
          />
        </div>
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
                ? "bg-foreground text-background hover:bg-foreground/85"
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

/* ===================== CHAT BUBBLES ===================== */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-foreground px-4 py-3">
        <p className="text-sm leading-relaxed text-background">{text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({
  msg,
  isGuest,
  onFeedback,
}: {
  msg: ChatMessage;
  isGuest: boolean;
  onFeedback: (title: string, platform: string, sentiment: "love" | "like" | "dislike" | "seen") => void;
}) {
  const { data } = msg;
  if (!data) return null;

  const { main, alternatives } = data;
  const mainFeedback = msg.feedbackGiven?.[main.title] ?? null;
  const deepLink = deepLinkFor(main.platform, main.title);

  return (
    <div className="flex flex-col gap-3">
      {/* Main recommendation */}
      <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-border bg-white px-4 py-4 shadow-sm">
        <p className="text-sm leading-relaxed text-foreground">
          Te recomiendo{" "}
          <strong className="font-bold">{main.title}</strong>{" "}
          <span className="text-muted-foreground">({main.duration})</span>
          {" — "}
          {main.reason}
          {" "}
          Disponible en{" "}
          <strong className="font-bold" style={{ color: colorForPlatform(main.platform) }}>
            {main.platform}
          </strong>
          .
        </p>

        <div className="mt-3 flex items-center gap-2">
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:border-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Ver en {main.platform}
          </a>
        </div>

        {!isGuest && (
          <div className="mt-3 border-t border-border pt-3">
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

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <div className="max-w-[85%] space-y-2">
          {alternatives.map((alt) => {
            const altFeedback = msg.feedbackGiven?.[alt.title] ?? null;
            return (
              <div
                key={alt.title}
                className="rounded-xl border border-border bg-muted/40 px-4 py-3"
              >
                <p className="text-xs leading-relaxed text-foreground">
                  O también:{" "}
                  <strong className="font-semibold">{alt.title}</strong>
                  {" "}en{" "}
                  <span className="font-medium" style={{ color: colorForPlatform(alt.platform) }}>
                    {alt.platform}
                  </span>
                  {" — "}
                  <span className="text-muted-foreground">{alt.reason}</span>
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <a
                    href={deepLinkFor(alt.platform, alt.title)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    {alt.platform}
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
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===================== FEEDBACK ===================== */

function FeedbackRow({
  feedback,
  onLove,
  onLike,
  onDislike,
  onSeen,
}: {
  feedback: "love" | "like" | "dislike" | "seen" | null;
  onLove: () => void;
  onLike: () => void;
  onDislike: () => void;
  onSeen: () => void;
}) {
  if (feedback === "love") {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Heart className="h-3.5 w-3.5 fill-current" />
        ¡Te encanta! Lo recordamos.
      </div>
    );
  }
  if (feedback === "like") {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <ThumbsUp className="h-3.5 w-3.5" />
        Te gusta. Lo recordamos.
      </div>
    );
  }
  if (feedback === "dislike" || feedback === "seen") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5" />
        {feedback === "seen" ? "Marcado como ya vista." : "Descartado."}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onLove}
        className="group flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        <Heart className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
        <span>Amo</span>
      </button>
      <button
        onClick={onLike}
        className="group flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        <ThumbsUp className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
        <span>Va</span>
      </button>
      <button
        onClick={onDislike}
        className="group flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
      >
        <ThumbsDown className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
        <span>No</span>
      </button>
      <button
        onClick={onSeen}
        className="group flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <EyeOff className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
        <span>Ya la vi</span>
      </button>
    </div>
  );
}

function CompactFeedback({
  feedback,
  onLike,
  onDislike,
  onSeen,
}: {
  feedback: "love" | "like" | "dislike" | "seen" | null;
  onLike: () => void;
  onDislike: () => void;
  onSeen: () => void;
}) {
  if (feedback) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {feedback === "like" || feedback === "love" ? "✓ Guardado" : "✗ Descartado"}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={onLike} className="text-muted-foreground transition-colors hover:text-primary" title="Me gusta">
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button onClick={onDislike} className="text-muted-foreground transition-colors hover:text-destructive" title="No me gusta">
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      <button onClick={onSeen} className="text-muted-foreground transition-colors hover:text-foreground" title="Ya la vi">
        <EyeOff className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
