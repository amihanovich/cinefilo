import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles, ChevronLeft, ChevronRight, Send, Mic,
  User, Bookmark, ThumbsUp, Copy, Check, LayoutGrid, Loader2, Tv, X,
} from "lucide-react";
import { inferContext, contextToPromptHint, seasonHintShort } from "./lib/context";
import { fetchRecommendation, fetchPosters, fetchAsk, warmupBackend } from "./lib/api";
import { colorForPlatform, platformLabel } from "./lib/deeplink";
import { jwSearch, openNative, openInApp } from "./lib/justwatch";
import { VoiceRecorder, transcribe } from "./lib/stt";
import { VoiceAgentOverlay, type VoiceResult } from "./components/VoiceAgent";
import { AccountSheet } from "./components/AccountSheet";
import { Orb } from "./components/Orb";
import { track } from "./lib/analytics";
import type { Recommendation, Message } from "./lib/api";
import type { JwResult } from "./lib/justwatch";

// ── Constantes ──────────────────────────────────────────────────────────────
const WATCHLIST_KEY = "cinefilo:watchlist";
const LIKED_KEY = "cinefilo:liked";
// Star+ se fusionó con Disney+ en LatAm (2024) — ya no es seleccionable,
// pero los mapeos internos (color, label, deeplink) se mantienen para datos viejos.
const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];
const COUNTRY_KEY = "cinefilo:country";
const PLATFORMS_KEY = "queveo:guest:default_platforms";
const TV_BANNER_KEY = "cinefilo:tvBannerDismissed";

type SavedItem = { title: string; platform: string; type: string };
type Screen = "welcome" | "platforms" | "magic" | "gallery";

// ── Helpers localStorage ─────────────────────────────────────────────────────
function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function addToStore(key: string, item: SavedItem): void {
  try {
    const arr: SavedItem[] = JSON.parse(localStorage.getItem(key) ?? "[]") as SavedItem[];
    if (!arr.find((i) => i.title === item.title)) arr.unshift(item);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch { /* noop */ }
}
function removeFromStore(key: string, title: string): void {
  try {
    const arr: SavedItem[] = JSON.parse(localStorage.getItem(key) ?? "[]") as SavedItem[];
    localStorage.setItem(key, JSON.stringify(arr.filter((i) => i.title !== title)));
  } catch { /* noop */ }
}

// Fallback offline: deduce el país desde la timezone del dispositivo.
function countryFromTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (tz.startsWith("America/Argentina")) return "AR";
    const map: Record<string, string> = {
      "America/Montevideo": "UY",
      "America/Santiago": "CL",
      "America/Mexico_City": "MX",
      "America/Bogota": "CO",
      "America/Lima": "PE",
      "America/Sao_Paulo": "BR",
      "Europe/Madrid": "ES",
    };
    return map[tz] ?? null;
  } catch { return null; }
}

async function detectCountry(): Promise<void> {
  if (localStorage.getItem(COUNTRY_KEY)) return;
  try {
    const res = await fetch("https://ipapi.co/country/", { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const code = (await res.text()).trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) {
        localStorage.setItem(COUNTRY_KEY, code);
        return;
      }
    }
  } catch { /* silencioso */ }
  // ipapi falló (rate limit / sin red): timezone del dispositivo como fallback
  const tzCountry = countryFromTimezone();
  if (tzCountry) localStorage.setItem(COUNTRY_KEY, tzCountry);
}
function getCountry(): string { return localStorage.getItem(COUNTRY_KEY) ?? "AR"; }
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ¿Es una pregunta sobre el título en pantalla (y no un pedido de recomendaciones nuevas)?
function isDetailQuery(q: string): boolean {
  const t = q.toLowerCase();
  return /contame|explicame|explicá|por qu[eé]|de qu[eé] trata|sinopsis|argumento|director|reparto|elenco|cast|qui[eé]n|cu[aá]ndo sali[oó]|vale la pena|es buena|es mala|opini[oó]n|m[aá]s info|final|se parece|similar a|c[oó]mo termina|d[oó]nde se film[oó]|actores|actriz|protagonista/.test(t);
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function WizardPage({ onComplete }: { onComplete?: () => void } = {}) {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [platforms, setPlatforms] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]") as string[]; }
    catch { return []; }
  });

  // Cards
  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  // Galería
  const [galleryItems, setGalleryItems] = useState<Recommendation[]>([]);
  const [galleryPosters, setGalleryPosters] = useState<Record<string, string | null>>({});
  const [gallerySelected, setGallerySelected] = useState<Set<string>>(new Set());
  const [galleryLoading, setGalleryLoading] = useState(false);

  // Chat / conversación
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState("");
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Todos los títulos ya mostrados en la sesión — evita que la IA repita
  // recomendaciones de búsquedas anteriores (no solo del deck actual).
  const shownTitlesRef = useRef<Set<string>>(new Set());
  const rememberShown = (recos: Recommendation[]) => {
    for (const r of recos) shownTitlesRef.current.add(r.title);
  };
  const excludeList = () => [...shownTitlesRef.current].slice(-40); // cap para no inflar el prompt

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  // UI states
  const [voiceMode, setVoiceMode] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [micRecording, setMicRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [watchlisted, setWatchlisted] = useState<Set<string>>(() => loadSet(WATCHLIST_KEY));
  const [liked, setLiked] = useState<Set<string>>(() => loadSet(LIKED_KEY));
  const [tvBanner, setTvBanner] = useState(() => localStorage.getItem(TV_BANNER_KEY) !== "1");
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  const dismissTvBanner = () => {
    localStorage.setItem(TV_BANNER_KEY, "1");
    setTvBanner(false);
  };

  const touchStartX = useRef(0);
  const micRecorderRef = useRef<VoiceRecorder | null>(null);

  // Auto-advance welcome → platforms
  useEffect(() => {
    if (screen !== "welcome") return;
    void detectCountry();
    warmupBackend(); // despierta Railway mientras el usuario mira el welcome
    const t = setTimeout(() => setScreen("platforms"), 2000);
    return () => clearTimeout(t);
  }, [screen]);

  // ── Disponibilidad JustWatch ──────────────────────────────────────────────
  const loadAvailability = useCallback(async (allItems: Recommendation[]) => {
    const country = getCountry();
    await Promise.allSettled(
      allItems.map(async (item) => {
        const result = await jwSearch(item.title, item.platform, item.type, country);
        setAvailability((prev) => ({ ...prev, [item.title]: result }));
      })
    );
  }, []);

  // ── Recomendación normal (5 cards) ───────────────────────────────────────
  const getReco = async (userQuery: string, queryType: "auto" | "text" | "voice" = "text") => {
    setAgentReply(null);
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
        excludeTitles: excludeList(),
        alternativesCount: 4,
      });

      if (!data?.main) throw new Error("Sin resultado");

      const allItems = [data.main, ...(data.alternatives ?? []).slice(0, 4)];
      const assistantSummary = `Recomendé: ${data.main.title} y ${(data.alternatives ?? []).slice(0, 4).map((a) => a.title).join(", ")}.`;

      rememberShown(allItems);
      setMessages([...newMessages, { role: "assistant", content: assistantSummary }]);
      setItems(allItems);
      setPosters({});
      setAvailability({});
      setCurrentIndex(0);
      setScreen("magic");
      setLoading(false);

      track("recommendation_received", { query_type: queryType, platforms: effectivePlatforms });

      void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
      void loadAvailability(allItems);
    } catch (e) {
      console.error("[wizard]", e);
      setLoading(false);
      showError("No pudimos buscar. Revisá tu conexión e intentá de nuevo.");
    }
  };

  // ── Galería: carga ~16 opciones ───────────────────────────────────────────
  const loadGallery = async () => {
    setGalleryLoading(true);
    setGallerySelected(new Set());
    setGalleryItems([]);
    setGalleryPosters({});
    setScreen("gallery");

    const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
    const ctx = inferContext();

    try {
      const data = await fetchRecommendation({
        messages: [...messages, { role: "user", content: "Mostrame más opciones variadas" }],
        platforms: effectivePlatforms,
        contextHint: contextToPromptHint(ctx),
        seasonHint: seasonHintShort(ctx),
        weatherHint: null,
        excludeTitles: excludeList(),
        alternativesCount: 15,
      });

      if (!data?.main) throw new Error("Sin resultado");

      const all = [data.main, ...(data.alternatives ?? [])];
      rememberShown(all);
      setGalleryItems(all);
      setGalleryLoading(false);
      track("gallery_opened", { titles_shown: all.length });

      void fetchPosters(all.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setGalleryPosters);
    } catch {
      setGalleryLoading(false);
      setScreen("magic");
      showError("No pudimos cargar más opciones. Intentá de nuevo.");
    }
  };

  const confirmGallerySelection = () => {
    const selected = galleryItems.filter((i) => gallerySelected.has(i.title));
    const toShow = selected.length > 0 ? selected : galleryItems;
    track("gallery_selection", { selected_count: selected.length, total: galleryItems.length });
    setItems(toShow);
    setPosters(galleryPosters);
    setAvailability({});
    setCurrentIndex(0);
    setScreen("magic");
    void loadAvailability(toShow);
  };

  // ── Navegación ────────────────────────────────────────────────────────────
  const navigate = (newIndex: number) => {
    setCurrentIndex(newIndex);
    setAgentReply(null); // la respuesta era sobre la card anterior
    track("card_viewed", {
      card_index: newIndex,
      title: items[newIndex]?.title,
      platform: items[newIndex]?.platform,
    });
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || loading) return;
    setChatText("");

    // Pregunta sobre el título en pantalla → respuesta conversacional,
    // SIN pisar el deck actual con recomendaciones nuevas.
    const currentItem = items[currentIndex];
    if (screen === "magic" && currentItem && isDetailQuery(text)) {
      setLoading(true);
      track("detail_question", { title: currentItem.title });
      try {
        const { answer } = await fetchAsk({
          title: currentItem.title,
          platform: currentItem.platform,
          question: text,
        });
        setAgentReply(answer || null);
      } catch {
        showError("No pude responder eso. Intentá de nuevo.");
      } finally {
        setLoading(false);
      }
      return;
    }

    const turnNumber = messages.filter((m) => m.role === "user").length + 1;
    track("refinement_made", { turn_number: turnNumber });
    await getReco(text, "text");
  };

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
      } catch { /* silencioso */ }
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
            } catch { /* silencioso */ }
          },
          silenceMs: 2500,
        });
      } catch {
        setMicRecording(false);
        micRecorderRef.current = null;
      }
    }
  };

  // ── Voice agent ───────────────────────────────────────────────────────────
  const handleVoiceResult = (result: VoiceResult) => {
    const allItems = result.items;
    rememberShown(allItems);
    setAgentReply(null);
    setItems(allItems);
    setPosters({});
    setAvailability({});
    setCurrentIndex(0);
    setMessages(result.messages);
    setScreen("magic");
    track("recommendation_received", { query_type: "voice" });
    void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
    void loadAvailability(allItems);
  };

  // ── Acciones de cards ─────────────────────────────────────────────────────
  const toggleWatchlist = (item: Recommendation) => {
    const isIn = watchlisted.has(item.title);
    setWatchlisted((prev) => { const n = new Set(prev); isIn ? n.delete(item.title) : n.add(item.title); return n; });
    if (isIn) removeFromStore(WATCHLIST_KEY, item.title);
    else { addToStore(WATCHLIST_KEY, { title: item.title, platform: item.platform, type: item.type }); track("saved", { title: item.title, platform: item.platform }); }
  };

  const toggleLike = (item: Recommendation) => {
    const isIn = liked.has(item.title);
    setLiked((prev) => { const n = new Set(prev); isIn ? n.delete(item.title) : n.add(item.title); return n; });
    if (isIn) removeFromStore(LIKED_KEY, item.title);
    else { addToStore(LIKED_KEY, { title: item.title, platform: item.platform, type: item.type }); track("liked", { title: item.title, platform: item.platform }); }
  };

  const copyTitle = (title: string, platform: string) => {
    void navigator.clipboard.writeText(title).then(() => {
      setCopied(true);
      track("title_copied", { title, platform });
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const openStreaming = (current: Recommendation, avail: JwResult | undefined) => {
    track("watch_now_tapped", {
      title: current.title,
      platform: current.platform,
      availability_confirmed: !!avail?.confirmed,
    });
    if (avail?.confirmed) {
      void openNative(avail);
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
      const webUrl = urls[current.platform] ?? `https://www.google.com/search?q=${q}+ver+online`;
      // Abre la app nativa (scheme/App Link) si está instalada; sino, web.
      void openInApp(current.platform, webUrl, current.title);
    }
  };

  // ── Inicio ────────────────────────────────────────────────────────────────
  const handleStartReco = () => {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    track("wizard_complete", { platforms_count: platforms.length, platforms });
    if (onComplete) { onComplete(); return; }
    const ctx = inferContext();
    void getReco(`lo mejor para ${contextToPromptHint(ctx) || "esta noche"}`, "auto");
  };

  // ════════════════════════════════════════════════════════════════════════════
  // PANTALLA: WELCOME
  // ════════════════════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════════════════════
  // PANTALLA: PLATFORMS
  // ════════════════════════════════════════════════════════════════════════════
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
                onClick={() => setPlatforms((prev) => selected ? prev.filter((x) => x !== p) : [...prev, p])}
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
          {offline && (
            <p className="mb-3 text-center text-xs font-semibold text-amber-500">Sin conexión — conectate para buscar</p>
          )}
          {error && (
            <p className="mb-3 text-center text-xs font-semibold text-red-400">{error}</p>
          )}
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

  // ════════════════════════════════════════════════════════════════════════════
  // PANTALLA: GALERÍA
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "gallery") {
    const selectedCount = gallerySelected.size;

    return (
      <div className="flex h-[100dvh] flex-col bg-background safe-top safe-bottom">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <button
            onClick={() => setScreen("magic")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90 transition-transform"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <p className="text-base font-bold text-foreground">Más opciones</p>
            <p className="text-[11px] text-muted-foreground">Tocá las que te interesan</p>
          </div>
          <button
            onClick={confirmGallerySelection}
            disabled={galleryLoading}
            className="rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background active:scale-95 transition-transform disabled:opacity-40"
          >
            {selectedCount > 0 ? `Ver ${selectedCount} →` : "Ver todas →"}
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {galleryLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Buscando más opciones...</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {galleryItems.map((item) => {
                const isSelected = gallerySelected.has(item.title);
                const poster = galleryPosters[item.title];
                const color = colorForPlatform(item.platform);
                return (
                  <button
                    key={item.title}
                    onClick={() => {
                      setGallerySelected((prev) => {
                        const n = new Set(prev);
                        isSelected ? n.delete(item.title) : n.add(item.title);
                        return n;
                      });
                    }}
                    className="relative overflow-hidden rounded-xl active:scale-95 transition-transform"
                    style={{ WebkitTapHighlightColor: "transparent" }}
                  >
                    {/* Poster */}
                    <div className="relative h-32 w-full" style={!poster ? { backgroundColor: `${color}20` } : undefined}>
                      {poster ? (
                        <img src={poster} alt={item.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="text-3xl font-black opacity-10" style={{ color }}>
                            {item.title.charAt(0)}
                          </span>
                        </div>
                      )}

                      {/* Gradiente + título */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1.5 pt-4">
                        <p className="line-clamp-2 text-[10px] font-semibold leading-tight text-white">
                          {item.title}
                        </p>
                        <span
                          className="mt-0.5 inline-block rounded-full px-1 py-px text-[8px] font-bold text-white"
                          style={{ backgroundColor: color }}
                        >
                          {platformLabel(item.platform)}
                        </span>
                      </div>

                      {/* Overlay de selección */}
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-primary/50">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
                            <Check className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PANTALLA: MAGIC (cards)
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "magic" && items.length > 0) {
    const safeIndex = Math.min(currentIndex, Math.max(0, items.length - 1));
    const current = items[safeIndex];
    const poster = current ? posters[current.title] : undefined;
    const avail = current ? availability[current.title] : undefined;
    const hasPrev = safeIndex > 0;
    const hasNext = safeIndex < items.length - 1;
    const platformColor = current ? colorForPlatform(current.platform) : "#888";
    const label = current ? platformLabel(current.platform) : "";

    return (
      <div className="relative flex h-[100dvh] flex-col bg-background safe-top safe-bottom">

        {/* Sin conexión (persistente mientras dure) */}
        {offline && (
          <div className="absolute inset-x-0 top-2 z-40 flex justify-center px-5">
            <div className="rounded-full bg-amber-500/90 px-4 py-1.5 text-[11px] font-semibold text-black shadow-lg">
              Sin conexión — algunas funciones no van a andar
            </div>
          </div>
        )}

        {/* Barra de error (auto-desaparece) */}
        {error && (
          <div className="absolute inset-x-0 top-14 z-40 flex justify-center px-5">
            <div className="rounded-full bg-red-500/90 px-4 py-2 text-[11px] font-semibold text-white shadow-lg">
              {error}
            </div>
          </div>
        )}

        <AccountSheet
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          onPlatformsChange={setPlatforms}
          onCountryChange={() => { setAvailability({}); void loadAvailability(items); }}
        />

        {/* Banner promo Cinéfilo TV (dummy, descartable) */}
        {tvBanner && (
          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-30 flex justify-center px-5">
            <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/15 to-purple-500/15 p-3 shadow-xl backdrop-blur-md">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
                <Tv className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold leading-tight text-foreground">Cinéfilo para tu TV</p>
                <p className="text-[10px] leading-tight text-muted-foreground">Viví la experiencia directo en tu televisor</p>
              </div>
              <button
                onClick={dismissTvBanner}
                className="rounded-full bg-primary px-3 py-1.5 text-[10px] font-bold text-white active:scale-95 transition-transform"
              >
                Pronto
              </button>
              <button
                onClick={dismissTvBanner}
                aria-label="Descartar"
                className="shrink-0 text-muted-foreground/50 active:scale-90 transition-transform"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

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
          <button
            onClick={() => setAccountOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90 transition-transform"
            aria-label="Mi cuenta"
          >
            <User className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Cinéfilo</span>
          </div>

          <button
            onClick={() => { track("voice_used"); setVoiceMode(true); }}
            className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 transition-all active:scale-95"
          >
            <Orb phase="idle" size="mini" />
            <span className="text-[10px] font-semibold text-primary">Hablar con Cinéfilo</span>
          </button>
        </div>

        {/* Chat */}
        <div className="shrink-0 px-5 pt-3 pb-3">
          <div className={cn("flex items-center gap-2 rounded-2xl bg-muted px-3", loading && "pointer-events-none")}>
            <button
              onClick={() => void toggleMic()}
              disabled={loading}
              className={cn(
                "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                micRecording ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={micRecording ? "Detener" : "Grabar"}
            >
              <Mic className="h-4 w-4" />
              {micRecording && (
                <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/40 animate-ping" />
              )}
            </button>
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
              placeholder={micRecording ? "Escuchando..." : loading ? "Pensando..." : "Más oscuro · ¿de qué trata? · otra cosa..."}
              disabled={loading || micRecording}
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <button
              onClick={() => void sendChat()}
              disabled={!chatText.trim() || loading}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-20"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Respuesta del Cinéfilo sobre el título en pantalla */}
          {agentReply && (
            <div className="mt-2 flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="flex-1 text-[12px] leading-relaxed text-foreground/85">{agentReply}</p>
              <button
                onClick={() => setAgentReply(null)}
                aria-label="Cerrar respuesta"
                className="shrink-0 text-muted-foreground/50 active:scale-90 transition-transform"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Hero card */}
        <div className="flex-1 min-h-0 flex flex-col gap-2 px-5 pb-2">
          {current ? (
            <>
              <div
                className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-border bg-muted/30 select-none"
                onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                onTouchEnd={(e) => {
                  const dx = e.changedTouches[0].clientX - touchStartX.current;
                  if (dx < -50 && hasNext) navigate(safeIndex + 1);
                  else if (dx > 50 && hasPrev) navigate(safeIndex - 1);
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
                    {/* Título + copiar (ícono discreto para no apretar el título) */}
                    <div className="flex items-start gap-2">
                      <h2 className="flex-1 text-base font-bold leading-tight text-foreground">{current.title}</h2>
                      <button
                        onClick={() => copyTitle(current.title, current.platform)}
                        className={cn(
                          "mt-0.5 shrink-0 transition-transform active:scale-90",
                          copied ? "text-green-400" : "text-muted-foreground/40"
                        )}
                        aria-label={copied ? "¡Copiado!" : "Copiar título"}
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: platformColor }}>
                        {label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {current.type} · {current.duration}{current.year && ` · ${current.year}`}
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
                        <span className="text-[10px] text-muted-foreground/50">Verificalo al abrir la app</span>
                      )}
                    </div>

                    <p className="mt-1 flex-1 text-[13px] leading-relaxed text-foreground/70 line-clamp-3">
                      {current.reason}
                    </p>

                    <button
                      onClick={() => openStreaming(current, avail)}
                      className="mt-2 w-full rounded-full py-2.5 text-center text-xs font-bold text-white active:scale-95 transition-transform"
                      style={{ backgroundColor: platformColor }}
                    >
                      ▶ Ver ahora en {label}
                    </button>

                    {/* Like + Guardar */}
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => toggleLike(current)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-[11px] font-semibold transition-all active:scale-95",
                          liked.has(current.title) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        <ThumbsUp className="h-3 w-3" />
                        {liked.has(current.title) ? "¡Me gustó!" : "Me gustó"}
                      </button>
                      <button
                        onClick={() => toggleWatchlist(current)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-[11px] font-semibold transition-all active:scale-95",
                          watchlisted.has(current.title) ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-border text-muted-foreground"
                        )}
                      >
                        <Bookmark className="h-3 w-3" />
                        {watchlisted.has(current.title) ? "Guardado" : "Ver luego"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <p className="shrink-0 text-center text-[11px] font-medium text-muted-foreground">
                ← deslizá para ver alternativas →
              </p>
            </>
          ) : null}
        </div>

        {/* Navegación + "Ver más" */}
        <div className="shrink-0 px-5 pt-1 pb-8">
          {/* Dots de posición */}
          <div className="mb-2 flex items-center justify-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => navigate(i)}
                aria-label={`Ir a ${i + 1}`}
                className={cn("h-1.5 rounded-full transition-all", i === safeIndex ? "w-4 bg-foreground" : "w-1.5 bg-foreground/20")}
              />
            ))}
          </div>

          {/* Anterior · Ver más (siempre) · Siguiente */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(safeIndex - 1)}
              disabled={!hasPrev}
              aria-label="Anterior"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-border transition-transform active:scale-95 disabled:opacity-20"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              onClick={() => void loadGallery()}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-primary/10 border-2 border-primary/30 text-primary font-semibold transition-transform active:scale-95"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="text-sm">Ver más opciones</span>
            </button>

            <button
              onClick={() => navigate(safeIndex + 1)}
              disabled={!hasNext}
              aria-label="Siguiente"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-border transition-transform active:scale-95 disabled:opacity-20"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading / fallback
  if (loading) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Buscando las mejores opciones...</p>
      </div>
    );
  }

  return null;
}
