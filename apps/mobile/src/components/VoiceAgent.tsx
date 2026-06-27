import React, { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbPhase } from "./Orb";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { speak, stopSpeaking } from "../lib/tts";
import { fetchRecommendation, fetchPosters, type Recommendation, type Message } from "../lib/api";
import { inferContext, contextToPromptHint, seasonHintShort } from "../lib/context";
import { colorForPlatform, platformLabel, deepLinkFor } from "../lib/deeplink";
import { jwSearch, openNative, type JwResult } from "../lib/justwatch";
import { ChevronLeft, ChevronRight, Mic, Send } from "lucide-react";

const PLATFORMS_KEY = "queveo:guest:default_platforms";
const COUNTRY_KEY = "cinefilo:country";
const ALL_PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+", "Star+"];

function getCountry(): string {
  return localStorage.getItem(COUNTRY_KEY) ?? "AR";
}

function getPlatforms(): string[] {
  try {
    const saved = localStorage.getItem(PLATFORMS_KEY);
    return saved ? (JSON.parse(saved) as string[]) : [];
  } catch {
    return [];
  }
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ── Types ────────────────────────────────────────────────────────────────────

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "ready";

// ── VoiceAgent ────────────────────────────────────────────────────────────────

export default function VoiceAgent() {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [volume, setVolume] = useState(0);
  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState("");
  const [cinephileNote, setCinephileNote] = useState<string | null>(null);
  const [hint, setHint] = useState<string>("Tocá para empezar");

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const touchStartX = useRef(0);

  const orbPhase: OrbPhase =
    agentState === "listening" ? "listening"
    : agentState === "thinking" ? "thinking"
    : agentState === "speaking" ? "speaking"
    : "idle";

  const showCards = agentState === "speaking" || agentState === "ready";

  // ── Core flow ─────────────────────────────────────────────────────────────

  const runRecommendation = useCallback(async (userQuery: string) => {
    setAgentState("thinking");
    setHint("Pensando...");

    const effectivePlatforms = getPlatforms();
    const ctx = inferContext();
    const newMessages: Message[] = [...messages, { role: "user", content: userQuery }];

    try {
      const data = await fetchRecommendation({
        messages: newMessages,
        platforms: effectivePlatforms.length > 0 ? effectivePlatforms : ALL_PLATFORMS,
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

      // Start speaking the cinephile note while cards slide in
      if (data.cinephile_note) {
        setAgentState("speaking");
        setHint("Escuchá...");
        await speak(
          data.cinephile_note,
          undefined,
          () => setAgentState("ready"),
        );
        if (agentState === "speaking") setAgentState("ready");
      } else {
        setAgentState("ready");
      }

      setHint("Tocá el orbe para buscar de nuevo");

      // Posters + availability in background
      void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
      const country = getCountry();
      void Promise.allSettled(
        allItems.map(async (item) => {
          const result = await jwSearch(item.title, item.platform, item.type, country);
          setAvailability((prev: Record<string, JwResult>) => ({ ...prev, [item.title]: result }));
        }),
      );
    } catch (e) {
      console.error("[VoiceAgent]", e);
      setAgentState("idle");
      setHint("Algo salió mal. Tocá para intentar de nuevo.");
    }
  }, [messages, items, agentState]);

  // ── Voice interaction ─────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (agentState !== "idle" && agentState !== "ready") return;
    stopSpeaking();
    setAgentState("listening");
    setHint("Te escucho...");

    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start({
        onVolume: setVolume,
        onAutoStop: async () => {
          const blob = await recorder.stop();
          recorderRef.current = null;
          setVolume(0);
          if (blob.size < 1000) {
            setAgentState(items.length > 0 ? "ready" : "idle");
            setHint(items.length > 0 ? "Tocá el orbe para buscar de nuevo" : "Tocá para empezar");
            return;
          }
          setAgentState("thinking");
          setHint("Transcribiendo...");
          try {
            const text = await transcribe(blob);
            if (!text.trim()) {
              setAgentState(items.length > 0 ? "ready" : "idle");
              setHint("No te escuché bien. Intentá de nuevo.");
              return;
            }
            setHint(`"${text}"`);
            await runRecommendation(text);
          } catch (e) {
            console.error("[stt]", e);
            setAgentState(items.length > 0 ? "ready" : "idle");
            setHint("Error al transcribir. Intentá de nuevo.");
          }
        },
        silenceMs: 2000,
      });
    } catch (e) {
      console.error("[mic]", e);
      recorderRef.current = null;
      setAgentState(items.length > 0 ? "ready" : "idle");
      setHint("No se pudo acceder al micrófono.");
    }
  }, [agentState, items.length, runRecommendation]);

  const stopListening = useCallback(async () => {
    if (agentState !== "listening") return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    const blob = await recorder.stop();
    recorderRef.current = null;
    setVolume(0);
    if (blob.size < 1000) {
      setAgentState(items.length > 0 ? "ready" : "idle");
      setHint(items.length > 0 ? "Tocá el orbe para buscar de nuevo" : "Tocá para empezar");
      return;
    }
    setAgentState("thinking");
    setHint("Transcribiendo...");
    try {
      const text = await transcribe(blob);
      if (!text.trim()) {
        setAgentState(items.length > 0 ? "ready" : "idle");
        setHint("No te escuché bien. Intentá de nuevo.");
        return;
      }
      setHint(`"${text}"`);
      await runRecommendation(text);
    } catch (e) {
      console.error("[stt]", e);
      setAgentState(items.length > 0 ? "ready" : "idle");
      setHint("Error al transcribir. Intentá de nuevo.");
    }
  }, [agentState, items.length, runRecommendation]);

  const handleOrbClick = useCallback(() => {
    if (agentState === "listening") {
      void stopListening();
    } else if (agentState === "idle" || agentState === "ready") {
      void startListening();
    }
  }, [agentState, startListening, stopListening]);

  // ── Text fallback ─────────────────────────────────────────────────────────

  const sendChat = useCallback(async () => {
    const text = chatText.trim();
    if (!text || agentState === "listening" || agentState === "thinking") return;
    setChatText("");
    await runRecommendation(text);
  }, [chatText, agentState, runRecommendation]);

  // ── Auto first-run on mount ───────────────────────────────────────────────

  useEffect(() => {
    const ctx = inferContext();
    const contextQuery = `lo mejor para ${contextToPromptHint(ctx) || "esta noche"}`;
    void runRecommendation(contextQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const current = items[currentIndex];
  const avail = current ? availability[current.title] : undefined;
  const poster = current ? posters[current.title] : undefined;
  const platformColor = current ? colorForPlatform(current.platform) : "#6d28d9";
  const label = current ? platformLabel(current.platform) : "";

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const navigate = (newIndex: number) => setCurrentIndex(newIndex);

  return (
    <div className="flex h-[100dvh] flex-col bg-background safe-top safe-bottom overflow-hidden">

      {/* ── MINI ORB + CARDS (visible when speaking/ready) ──────────────── */}
      {showCards ? (
        <>
          {/* Top strip: mini orb + hint */}
          <div className="shrink-0 flex items-center gap-3 px-5 pt-6 pb-2">
            <button
              onClick={handleOrbClick}
              className="shrink-0 flex items-center justify-center active:scale-90 transition-transform"
              aria-label="Buscar con voz"
            >
              <Orb phase={orbPhase} size="mini" volume={volume} />
            </button>
            <div className="min-w-0 flex-1">
              {cinephileNote && agentState === "speaking" ? (
                <p className="text-[11px] leading-snug text-foreground/60 line-clamp-2">{cinephileNote}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground/50 truncate">{hint}</p>
              )}
            </div>
          </div>

          {/* Chat input */}
          <div className="shrink-0 px-5 pb-2">
            <div className={cn(
              "flex items-center gap-2 rounded-2xl bg-muted px-4",
              (agentState === "thinking" || agentState === "listening") && "opacity-50 pointer-events-none"
            )}>
              <button
                onClick={handleOrbClick}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                aria-label="Voz"
              >
                <Mic className={cn(
                  "h-4 w-4 transition-colors",
                  agentState === "listening" ? "text-primary" : "text-muted-foreground"
                )} />
              </button>
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
                placeholder="Más oscuro · ¿de qué trata? · nuevo set..."
                className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
              />
              <button
                onClick={() => void sendChat()}
                disabled={!chatText.trim()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Hero card */}
          {current && (
            <div className="flex-1 min-h-0 flex flex-col gap-2 px-5 pb-2">
              <div
                className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-border bg-muted/30 select-none"
                onTouchStart={(e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; }}
                onTouchEnd={(e: React.TouchEvent) => {
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
                          window.open(deepLinkFor(current.platform, current.title), "_blank");
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

              {/* Dot nav + arrows */}
              <div className="shrink-0 flex items-center gap-3 px-1">
                <button
                  onClick={() => navigate(currentIndex - 1)}
                  disabled={!hasPrev}
                  className="flex h-10 flex-1 items-center justify-center gap-1 rounded-2xl border border-border transition-transform active:scale-95 disabled:opacity-20"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="text-xs font-semibold">Anterior</span>
                </button>

                <div className="flex flex-col items-center gap-1 px-2">
                  <span className="text-xs font-bold text-foreground">
                    {currentIndex + 1}
                    <span className="font-normal text-muted-foreground">/{items.length}</span>
                  </span>
                  <div className="flex gap-1">
                    {items.map((_item, i) => (
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
                  className="flex h-10 flex-1 items-center justify-center gap-1 rounded-2xl border border-border transition-transform active:scale-95 disabled:opacity-20"
                >
                  <span className="text-xs font-semibold">Siguiente</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* ── FULL-SCREEN ORB (idle / listening / thinking) ──────────────── */
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
          <button
            onClick={handleOrbClick}
            className="flex items-center justify-center active:scale-95 transition-transform"
            aria-label={agentState === "listening" ? "Detener" : "Hablar"}
          >
            <Orb phase={orbPhase} size="full" volume={volume} />
          </button>

          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm font-medium text-foreground/80">
              {agentState === "idle" && "Tocá para hablar"}
              {agentState === "listening" && "Escuchando... tocá para detener"}
              {agentState === "thinking" && hint}
            </p>
            {agentState === "idle" && (
              <p className="text-xs text-muted-foreground/50">
                Decile algo como "algo para el finde con lluvia"
              </p>
            )}
          </div>

          {/* Text fallback always available */}
          <div className="w-full">
            <div className={cn(
              "flex items-center gap-2 rounded-2xl bg-muted px-4",
              (agentState === "thinking" || agentState === "listening") && "opacity-50 pointer-events-none"
            )}>
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
                placeholder="O escribí acá..."
                className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
              />
              <button
                onClick={() => void sendChat()}
                disabled={!chatText.trim()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
