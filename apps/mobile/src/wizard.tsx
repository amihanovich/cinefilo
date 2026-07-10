import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles, ChevronLeft, ChevronRight, Send, Mic,
  User, Bookmark, ThumbsUp, Copy, Check, LayoutGrid, Loader2, Tv, X, Plus,
} from "lucide-react";
import { inferContext, contextToPromptHint, seasonHintShort } from "./lib/context";
import { fetchRecommendation, fetchPosters, fetchAsk, warmupBackend } from "./lib/api";
import { colorForPlatform, platformLabel } from "./lib/deeplink";
import { jwSearch, openNative, openInApp } from "./lib/justwatch";
import { VoiceRecorder, transcribe } from "./lib/stt";
import { VoiceAgentOverlay, type VoiceResult } from "./components/VoiceAgent";
import { AccountSheet } from "./components/AccountSheet";
import { Orb } from "./components/Orb";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { SearchLoading } from "./components/SearchLoading";
import { ControlScreen } from "./screens/ControlScreen";
import { scanTvQr, recentSession, saveSession, parseSession } from "./lib/tv-remote";
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
const OPENED_KEY = "cinefilo:opened_before";

type SavedItem = { title: string; platform: string; type: string };
type Screen = "welcome" | "magic" | "gallery";

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
    try {
      const saved = JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]") as string[];
      return saved.length > 0 ? saved : [...PLATFORMS];
    } catch { return [...PLATFORMS]; }
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

  // Carrito "Para ver hoy" (solo sesión) + ficha en overlay (long-press).
  const [cart, setCart] = useState<Recommendation[]>([]);
  const [detailItem, setDetailItem] = useState<Recommendation | null>(null);

  // Búsqueda en curso → pantalla de loading (Bloque 3). null = sin búsqueda activa.
  const [searchInfo, setSearchInfo] = useState<{ query: string; platforms: string[]; type: "auto" | "text" | "voice" } | null>(null);

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
  const [controlSession, setControlSession] = useState<string | null>(null);

  // Abre el control remoto de la TV: escanea el QR; si no hay cámara/plugin
  // (browser dev), cae a ingresar el código a mano.
  const openTvRemote = useCallback(async () => {
    track("tv_remote_open");
    const scanned = await scanTvQr();
    if (scanned) { saveSession(scanned); setControlSession(scanned); return; }
    const recent = recentSession();
    const typed = window.prompt(
      recent
        ? `Ingresá el código de la TV, o dejá vacío para reconectar (${recent}):`
        : "Ingresá el código que aparece debajo del QR en la TV:",
    );
    const id = typed?.trim() ? parseSession(typed) : recent;
    if (id) { saveSession(id); setControlSession(id); }
    else if (typed) showError("Código inválido.");
  }, []);

  // Testeo en browser: ?tvsession=<id> abre el control directo.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("tvsession");
    const id = s ? parseSession(s) : null;
    if (id) setControlSession(id);
  }, []);

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

  // Warmup del backend mientras se muestra el splash del welcome. El splash y el
  // paso a la Home los maneja WelcomeScreen (ya no auto-avanza a "platforms").
  useEffect(() => {
    if (screen !== "welcome") return;
    void detectCountry();
    warmupBackend();
  }, [screen]);

  // Semilla: si el usuario nunca eligió plataformas, arrancan TODAS activas.
  useEffect(() => {
    if (!localStorage.getItem(PLATFORMS_KEY)) {
      localStorage.setItem(PLATFORMS_KEY, JSON.stringify(PLATFORMS));
    }
  }, []);

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
    // Feedback inmediato (≤100ms): plataformas activas + eco del pedido.
    setSearchInfo({ query: userQuery, platforms: effectivePlatforms, type: queryType });
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
      setSearchInfo(null);

      track("recommendation_received", { query_type: queryType, platforms: effectivePlatforms });

      void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
      void loadAvailability(allItems);
      setGalleryItems([]);
      void loadGallery(); // precargar "más opciones" para la grilla continua
    } catch (e) {
      console.error("[wizard]", e);
      setLoading(false);
      setSearchInfo(null);
      showError("No pudimos buscar. Revisá tu conexión e intentá de nuevo.");
    }
  };

  // ── Galería: carga ~16 opciones ───────────────────────────────────────────
  // Carga "más opciones" en segundo plano para la grilla continua de la Home.
  const loadGallery = async () => {
    setGalleryLoading(true);
    setGalleryItems([]);
    setGalleryPosters({});

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
    setGalleryItems([]);
    void loadGallery();
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

  // ── Carrito "Para ver hoy" + long-press de la grilla ──────────────────────
  const inCart = (title: string) => cart.some((c) => c.title === title);
  const toggleCart = (item: Recommendation) => {
    setCart((prev) =>
      prev.some((c) => c.title === item.title)
        ? prev.filter((c) => c.title !== item.title)
        : [item, ...prev],
    );
  };
  const removeFromCart = (title: string) => setCart((prev) => prev.filter((c) => c.title !== title));

  // Tap corto = sumar/quitar del carrito; mantener presionado = abrir la ficha.
  const longPressRef = useRef(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPress = (item: Recommendation) => {
    longPressRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      longPressRef.current = true;
      setDetailItem(item);
    }, 450);
  };
  const endPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  const onTileClick = (item: Recommendation) => {
    if (longPressRef.current) { longPressRef.current = false; return; }
    toggleCart(item);
  };

  // ── Inicio ────────────────────────────────────────────────────────────────
  const handleStartReco = () => {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    track("wizard_complete", { platforms_count: platforms.length, platforms });
    if (onComplete) { onComplete(); return; }
    const ctx = inferContext();
    void getReco(`lo mejor para ${contextToPromptHint(ctx) || "esta noche"}`, "auto");
  };

  // Control remoto de la TV (full-screen sobre cualquier pantalla).
  if (controlSession) {
    return <ControlScreen session={controlSession} onClose={() => setControlSession(null)} />;
  }

  // Búsqueda en curso: pantalla de loading (reemplaza el resultado, con fade-in).
  if (searchInfo) {
    return <SearchLoading query={searchInfo.query} platforms={searchInfo.platforms} type={searchInfo.type} />;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PANTALLA: WELCOME
  // ════════════════════════════════════════════════════════════════════════════
  if (screen === "welcome") {
    return (
      <WelcomeScreen
        firstTime={!localStorage.getItem(OPENED_KEY)}
        busy={loading}
        error={error}
        onSubmit={(text) => { localStorage.setItem(OPENED_KEY, "1"); void getReco(text, "text"); }}
        onSurprise={() => { localStorage.setItem(OPENED_KEY, "1"); handleStartReco(); }}
      />
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
    const current = items[0];
    const poster = current ? posters[current.title] : undefined;
    const avail = current ? availability[current.title] : undefined;
    const platformColor = current ? colorForPlatform(current.platform) : "#888";
    const label = current ? platformLabel(current.platform) : "";
    // Grilla continua = alternativas (items[1..]) + "más opciones" (galleryItems), sin duplicar.
    const seenTitles = new Set([current.title]);
    const gridItems: Recommendation[] = [];
    for (const it of [...items.slice(1), ...galleryItems]) {
      if (!seenTitles.has(it.title)) { seenTitles.add(it.title); gridItems.push(it); }
    }
    const posterFor = (t: string) => posters[t] ?? galleryPosters[t];

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
          onOpenTvRemote={() => void openTvRemote()}
        />

        {/* (El banner promo dummy de "Cinéfilo para tu TV" se quitó: la entrada a
            la TV es el botón "TV" del header, que abre el escáner del QR.) */}

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAccountOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90 transition-transform"
              aria-label="Mi cuenta"
            >
              <User className="h-4 w-4" />
            </button>
            <button
              onClick={() => void openTvRemote()}
              className="flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-muted-foreground active:scale-90 transition-transform"
              aria-label="Controlar la TV"
            >
              <Tv className="h-4 w-4" /> <span className="text-[11px] font-semibold">TV</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Cinéfilo</span>
          </div>

          <button
            onClick={() => { track("voice_used"); setVoiceMode(true); }}
            className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 py-1 pl-1 pr-2.5 transition-all active:scale-95"
          >
            {/* Orbe reducido (~24px) para no apretar el header con el ícono de TV */}
            <span className="-m-3 scale-50">
              <Orb phase="idle" size="mini" />
            </span>
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

        {/* Contenido en scroll continuo: héroe + carrito + grilla */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8">
          {/* Héroe: recomendación principal (~mitad de pantalla) */}
          <div key={current.title} className="fade-in h-[46vh] min-h-[300px] overflow-hidden rounded-2xl border border-border bg-muted/30 select-none">
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
                <div className="flex items-start gap-2">
                  <h2 className="flex-1 text-base font-bold leading-tight text-foreground">{current.title}</h2>
                  <button
                    onClick={() => copyTitle(current.title, current.platform)}
                    className={cn("mt-0.5 shrink-0 transition-transform active:scale-90", copied ? "text-green-400" : "text-muted-foreground/40")}
                    aria-label={copied ? "¡Copiado!" : "Copiar título"}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: platformColor }}>{label}</span>
                  <span className="text-[11px] text-muted-foreground">{current.type} · {current.duration}{current.year && ` · ${current.year}`}</span>
                  {current.ageRating && (
                    <span className="rounded border border-muted-foreground/30 px-1 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">{current.ageRating}</span>
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

                <p className="mt-1 flex-1 text-[13px] leading-relaxed text-foreground/70 line-clamp-3">{current.reason}</p>

                <button
                  onClick={() => openStreaming(current, avail)}
                  className="mt-2 w-full rounded-full py-2.5 text-center text-xs font-bold text-white active:scale-95 transition-transform"
                  style={{ backgroundColor: platformColor }}
                >
                  ▶ Ver ahora en {label}
                </button>

                {/* Me gustó · Ver hoy (carrito) · Ver luego */}
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => toggleLike(current)}
                    className={cn("flex flex-1 items-center justify-center gap-1 rounded-full border py-2 text-[10px] font-semibold transition-all active:scale-95", liked.has(current.title) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                  >
                    <ThumbsUp className="h-3 w-3" /> {liked.has(current.title) ? "¡Gustó!" : "Me gustó"}
                  </button>
                  <button
                    onClick={() => toggleCart(current)}
                    className={cn("flex flex-1 items-center justify-center gap-1 rounded-full border py-2 text-[10px] font-semibold transition-all active:scale-95", inCart(current.title) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                  >
                    {inCart(current.title) ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Ver hoy
                  </button>
                  <button
                    onClick={() => toggleWatchlist(current)}
                    className={cn("flex flex-1 items-center justify-center gap-1 rounded-full border py-2 text-[10px] font-semibold transition-all active:scale-95", watchlisted.has(current.title) ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-border text-muted-foreground")}
                  >
                    <Bookmark className="h-3 w-3" /> Ver luego
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Carrito "Para ver hoy" (carrusel horizontal, entre héroe y grilla) */}
          {cart.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Check className="h-3.5 w-3.5 text-primary" /> Para ver hoy ({cart.length})
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {cart.map((it) => {
                  const p = posterFor(it.title);
                  const col = colorForPlatform(it.platform);
                  return (
                    <div key={it.title} className="w-20 shrink-0">
                      <div className="relative h-28 w-full overflow-hidden rounded-xl bg-muted" style={!p ? { backgroundColor: `${col}20` } : undefined}>
                        {p ? (
                          <img src={p} alt={it.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-2xl font-black opacity-10" style={{ color: col }}>{it.title.charAt(0)}</div>
                        )}
                        <button onClick={() => removeFromCart(it.title)} aria-label="Quitar" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white active:scale-90">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[9px] font-semibold leading-tight text-foreground">{it.title}</p>
                      <span className="text-[8px] font-bold" style={{ color: col }}>{platformLabel(it.platform)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Grilla de opciones (scroll continuo, sin título ni botón) */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {gridItems.map((item) => {
              const selected = inCart(item.title);
              const p = posterFor(item.title);
              const color = colorForPlatform(item.platform);
              return (
                <button
                  key={item.title}
                  onClick={() => onTileClick(item)}
                  onTouchStart={() => startPress(item)}
                  onTouchEnd={endPress}
                  onTouchMove={endPress}
                  className="relative overflow-hidden rounded-xl active:scale-95 transition-transform"
                  style={{ WebkitTapHighlightColor: "transparent" }}
                >
                  <div className="relative h-32 w-full" style={!p ? { backgroundColor: `${color}20` } : undefined}>
                    {p ? (
                      <img src={p} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="text-3xl font-black opacity-10" style={{ color }}>{item.title.charAt(0)}</span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1.5 pt-4">
                      <p className="line-clamp-2 text-[10px] font-semibold leading-tight text-white">{item.title}</p>
                      <span className="mt-0.5 inline-block rounded-full px-1 py-px text-[8px] font-bold text-white" style={{ backgroundColor: color }}>{platformLabel(item.platform)}</span>
                    </div>
                    {selected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-primary/50">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white"><Check className="h-4 w-4 text-primary" /></div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            {galleryLoading && gridItems.length < 6 && (
              <div className="col-span-3 flex items-center justify-center gap-2 py-6 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-xs">Cargando más opciones…</span>
              </div>
            )}
          </div>

          {gridItems.length > 0 && (
            <p className="mt-3 text-center text-[10px] text-muted-foreground/60">
              Tocá para sumar a "Para ver hoy" · mantené presionado para ver la ficha
            </p>
          )}
        </div>

        {/* Ficha completa (long-press en la grilla) */}
        {detailItem && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background safe-top safe-bottom">
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
              <button onClick={() => setDetailItem(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
              <p className="text-base font-bold text-foreground">Ficha</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="overflow-hidden rounded-2xl border border-border bg-muted/30">
                <div className="h-56 w-full overflow-hidden bg-muted">
                  {posterFor(detailItem.title) ? (
                    <img src={posterFor(detailItem.title)!} alt={detailItem.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="p-4">
                  <h2 className="text-xl font-bold text-foreground">{detailItem.title}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: colorForPlatform(detailItem.platform) }}>{platformLabel(detailItem.platform)}</span>
                    <span className="text-[11px] text-muted-foreground">{detailItem.type} · {detailItem.duration}{detailItem.year && ` · ${detailItem.year}`}</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-foreground/75">{detailItem.reason}</p>
                  <button
                    onClick={() => openStreaming(detailItem, availability[detailItem.title])}
                    className="mt-4 w-full rounded-full py-3 text-center text-sm font-bold text-white active:scale-95"
                    style={{ backgroundColor: colorForPlatform(detailItem.platform) }}
                  >
                    ▶ Ver ahora en {platformLabel(detailItem.platform)}
                  </button>
                  <button
                    onClick={() => toggleCart(detailItem)}
                    className={cn("mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border py-2.5 text-sm font-semibold active:scale-95", inCart(detailItem.title) ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground")}
                  >
                    {inCart(detailItem.title) ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {inCart(detailItem.title) ? "En tu lista de hoy" : "Agregar a Para ver hoy"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
