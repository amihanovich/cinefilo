import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent, type UIEvent as ReactUIEvent } from "react";
import {
  Sparkles, ChevronLeft, ChevronRight, Send, Mic,
  User, Bookmark, ThumbsUp, Copy, Check, LayoutGrid, Loader2, QrCode, X, Plus,
  Volume2, VolumeX, Keyboard, ChevronDown, ShoppingCart,
} from "lucide-react";
import { inferContext, contextToPromptHint, seasonHintShort } from "./lib/context";
import { fetchRecommendation, fetchPosters, fetchAsk, fetchIntent, warmupBackend } from "./lib/api";
import { speak, stopSpeaking, isMuted, setMuted } from "./lib/tts";
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
  const [cartOpen, setCartOpen] = useState(false); // carrito discreto expandible
  const [chatOpen, setChatOpen] = useState(false); // buscador de texto (secundario) colapsado
  const [detailItem, setDetailItem] = useState<Recommendation | null>(null);

  // Búsqueda en curso → pantalla de loading (Bloque 3). null = sin búsqueda activa.
  const [searchInfo, setSearchInfo] = useState<{ query: string; platforms: string[]; type: "auto" | "text" | "voice"; intent?: string | null } | null>(null);
  const [ttsMuted, setTtsMuted] = useState(() => { try { return isMuted(); } catch { return false; } });

  const toggleMute = () => {
    const next = !ttsMuted;
    setTtsMuted(next);
    setMuted(next); // persiste + corta lo que esté sonando si se mutea
  };

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
  const touchStartY = useRef(0);
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
    setSearchInfo({ query: userQuery, platforms: effectivePlatforms, type: queryType, intent: null });
    // (a.i) En paralelo, inferimos "lo más importante del pedido" con una llamada
    // chica y la mostramos arriba mientras la reco (más lenta) sigue en curso.
    void fetchIntent(userQuery).then((intent) => {
      if (intent) setSearchInfo((prev) => (prev ? { ...prev, intent } : prev));
    });
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

      // (e) Cinéfilo explica por voz por qué eligió estas opciones (respeta el mute).
      void speak(
        data.cinephile_note ?? `Te recomiendo ${data.main.title} en ${data.main.platform}.`,
      );

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

  // ── Galería / "más opciones" + carga infinita ─────────────────────────────
  const loadingMoreRef = useRef(false);
  const galleryDryRef = useRef(false);

  // Carga inicial de "más opciones" en segundo plano al recibir una búsqueda.
  const loadGallery = async () => {
    galleryDryRef.current = false;
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

  // Carga infinita: al acercarse al fondo, appendear otra tanda de opciones nuevas.
  const loadMoreGallery = async () => {
    if (loadingMoreRef.current || galleryDryRef.current) return;
    loadingMoreRef.current = true;
    setGalleryLoading(true);
    try {
      const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
      const ctx = inferContext();
      const data = await fetchRecommendation({
        messages: [...messages, { role: "user", content: "Mostrame más opciones distintas" }],
        platforms: effectivePlatforms,
        contextHint: contextToPromptHint(ctx),
        seasonHint: seasonHintShort(ctx),
        weatherHint: null,
        excludeTitles: excludeList(),
        alternativesCount: 12,
      });
      const all = data?.main ? [data.main, ...(data.alternatives ?? [])] : [];
      const existing = new Set([...items, ...galleryItems].map((i) => i.title));
      const fresh = all.filter((i) => !existing.has(i.title));
      if (fresh.length === 0) {
        galleryDryRef.current = true; // no hay más: cortamos el loop
      } else {
        rememberShown(fresh);
        setGalleryItems((prev) => [...prev, ...fresh]);
        void fetchPosters(fresh.map((i) => ({ title: i.title, type: i.type, year: i.year })))
          .then((p) => setGalleryPosters((prev) => ({ ...prev, ...p })));
      }
    } catch { /* noop */ }
    setGalleryLoading(false);
    loadingMoreRef.current = false;
  };

  const onGridScroll = (e: ReactUIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadMoreGallery();
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

  // Swipe horizontal sobre el héroe → cambiar de card. Coexiste con el scroll
  // vertical de la página: solo dispara si el eje horizontal es dominante y |dx|>50.
  const onHeroTouchStart = (e: ReactTouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onHeroTouchEnd = (e: ReactTouchEvent, heroCount: number) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // tap o scroll vertical
    const next = dx < 0 ? currentIndex + 1 : currentIndex - 1;
    if (next >= 0 && next < heroCount) navigate(next);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || loading) return;
    setChatText("");

    // Pregunta sobre el título en pantalla → respuesta conversacional,
    // SIN pisar el deck actual con recomendaciones nuevas.
    const currentItem = (cart.length > 0 ? cart : items)[currentIndex];
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
      // Press-to-speak / press-to-stop: sin auto-stop por silencio, el usuario frena.
      const recorder = new VoiceRecorder();
      micRecorderRef.current = recorder;
      setMicRecording(true);
      try {
        await recorder.start({ autoStop: false });
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
    const adding = !cart.some((c) => c.title === item.title);
    setCart((prev) =>
      prev.some((c) => c.title === item.title)
        ? prev.filter((c) => c.title !== item.title)
        : [item, ...prev],
    );
    // Al sumar, abrimos el carrito discreto para dar feedback (el hero NO salta:
    // sigue mostrando las recomendaciones de Cinéfilo).
    if (adding) setCartOpen(true);
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
    return <SearchLoading query={searchInfo.query} platforms={searchInfo.platforms} type={searchInfo.type} intent={searchInfo.intent} />;
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
    // El héroe muestra SIEMPRE las recomendaciones de Cinéfilo (top-5), sin importar
    // el carrito. Lo que sumás a "Para ver hoy" vive en la barra discreta de arriba.
    const heroItems = items.slice(0, 5);
    const heroIndex = Math.min(currentIndex, Math.max(0, heroItems.length - 1));
    const current = heroItems[heroIndex];
    const posterFor = (t: string) => posters[t] ?? galleryPosters[t];
    const poster = current ? posterFor(current.title) : undefined;
    const avail = current ? availability[current.title] : undefined;
    const platformColor = current ? colorForPlatform(current.platform) : "#888";
    const label = current ? platformLabel(current.platform) : "";
    // Grilla: ocultamos las 5 del héroe (ya se ven arriba) y mostramos el resto +
    // "más opciones", con check en las que ya están en el carrito.
    const heroTitles = new Set(heroItems.map((i) => i.title));
    const seenGrid = new Set<string>();
    const gridItems: Recommendation[] = [];
    for (const it of [...items, ...galleryItems]) {
      if (seenGrid.has(it.title)) continue;
      seenGrid.add(it.title);
      if (heroTitles.has(it.title)) continue;
      gridItems.push(it);
    }

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
            greet={false} /* (d) desde la Home no saluda: escucha directo */
            onResult={(result) => { handleVoiceResult(result); setVoiceMode(false); }}
            onDismiss={() => setVoiceMode(false)}
          />
        )}

        {/* Header: logo a la izquierda; "Conecta la TV" (con QR) + "Mi cuenta" a la derecha */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-6 pb-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-base font-bold text-foreground">Cinéfilo</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void openTvRemote()}
              className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-muted-foreground active:scale-90 transition-transform"
              aria-label="Conectar la TV"
            >
              <QrCode className="h-4 w-4" /> <span className="text-[11px] font-semibold">Conecta la TV</span>
            </button>
            <button
              onClick={() => setAccountOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90 transition-transform"
              aria-label="Mi cuenta"
            >
              <User className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Acción principal: Pedile a Cinéfilo (voz) + escribir (texto, secundario) + mute */}
        <div className="shrink-0 px-5 pt-3 pb-3 flex items-center gap-2">
          <button
            onClick={() => { track("voice_used"); setVoiceMode(true); }}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 py-3 transition-all active:scale-95"
          >
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
              <Orb phase="idle" size="mini" />
            </span>
            <span className="text-sm font-semibold text-primary">Pedile a Cinéfilo</span>
          </button>
          <button
            onClick={() => setChatOpen((v) => !v)}
            aria-label={chatOpen ? "Cerrar búsqueda por texto" : "Escribir la búsqueda"}
            title="Escribir"
            className={cn(
              "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border transition-all active:scale-95",
              chatOpen ? "border-foreground/40 bg-foreground/10 text-foreground" : "border-border bg-muted text-muted-foreground",
            )}
          >
            <Keyboard className="h-5 w-5" />
          </button>
          <button
            onClick={toggleMute}
            aria-label={ttsMuted ? "Activar la voz de Cinéfilo" : "Silenciar la voz de Cinéfilo"}
            title={ttsMuted ? "Voz silenciada" : "Voz activada"}
            className={cn(
              "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border transition-all active:scale-95",
              ttsMuted ? "border-border bg-muted text-muted-foreground" : "border-primary/30 bg-primary/5 text-primary",
            )}
          >
            {ttsMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>

        {/* Buscador de texto (secundario) — colapsado por defecto, se abre con "escribir" */}
        {chatOpen && (
          <div className="shrink-0 px-5 pb-3">
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
                autoFocus
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
          </div>
        )}

        {/* Respuesta del Cinéfilo sobre el título en pantalla (siempre que exista) */}
        {agentReply && (
          <div className="shrink-0 px-5 pb-3">
            <div className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2.5">
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
          </div>
        )}

        {/* Contenido en scroll continuo: héroe + grilla (con carga infinita) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8" onScroll={onGridScroll}>
          {/* Carrito "Para ver hoy" — discreto y expandible (no invade el héroe) */}
          {cart.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setCartOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] font-semibold text-foreground active:scale-95 transition-transform"
                aria-label={cartOpen ? "Ocultar tu lista de hoy" : "Ver tu lista de hoy"}
              >
                <ShoppingCart className="h-3.5 w-3.5 text-primary" />
                {cart.length} para ver hoy
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", cartOpen && "rotate-180")} />
              </button>

              {cartOpen && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {cart.map((c) => {
                    const p = posterFor(c.title);
                    return (
                      <div key={c.title} className="relative w-14 shrink-0">
                        <button
                          onClick={() => openStreaming(c, availability[c.title])}
                          className="block h-20 w-14 overflow-hidden rounded-lg border border-border bg-muted active:scale-95 transition-transform"
                        >
                          {p ? (
                            <img src={p} alt={c.title} className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full items-center justify-center p-1 text-center text-[8px] leading-tight text-muted-foreground">{c.title}</span>
                          )}
                        </button>
                        <button
                          onClick={() => removeFromCart(c.title)}
                          aria-label={`Quitar ${c.title}`}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white active:scale-90 transition-transform"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Tarjetas grandes (cinematográficas): póster de fondo + info sobre gradiente.
              Carrito (si tiene ítems) o top-5, swipe ←/→. */}
          <div
            key={current.title}
            onTouchStart={onHeroTouchStart}
            onTouchEnd={(e) => onHeroTouchEnd(e, heroItems.length)}
            className="fade-in relative h-[52vh] min-h-[340px] overflow-hidden rounded-3xl border border-border bg-muted select-none"
          >
            {/* Póster de fondo (con fallback tintado de la plataforma si no hay póster) */}
            {poster ? (
              <img src={poster} alt={current.title} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div
                className="absolute inset-0"
                style={{ background: `linear-gradient(160deg, ${platformColor}66, ${platformColor}22 45%, hsl(var(--background)))` }}
              />
            )}
            {/* Gradiente cinematográfico: base sólida oscura que sube a transparente */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent" />

            {/* Copiar título (sutil, arriba a la derecha) */}
            <button
              onClick={() => copyTitle(current.title, current.platform)}
              className={cn(
                "absolute right-3 top-3 z-10 rounded-full bg-black/40 p-2 backdrop-blur-sm transition-transform active:scale-90",
                copied ? "text-green-400" : "text-white/70",
              )}
              aria-label={copied ? "¡Copiado!" : "Copiar título"}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>

            {/* Info abajo, sobre el gradiente */}
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5">
              <h2 className="text-2xl font-bold leading-tight text-white">{current.title}</h2>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: platformColor }}>{label}</span>
                <span className="text-[12px] text-white/70">{current.type} · {current.duration}{current.year && ` · ${current.year}`}</span>
                {current.ageRating && (
                  <span className="rounded border border-white/30 px-1 py-0.5 text-[10px] font-semibold leading-none text-white/70">{current.ageRating}</span>
                )}
                {avail === undefined ? (
                  <span className="text-[10px] text-white/40">Verificando…</span>
                ) : avail.confirmed ? (
                  <span className="text-[10px] font-semibold text-green-400">✓ Disponible en {getCountry()}</span>
                ) : null}
              </div>

              <p className="text-[13px] leading-relaxed text-white/85 line-clamp-2">{current.reason}</p>

              <button
                onClick={() => openStreaming(current, avail)}
                className="mt-1 w-full rounded-full py-3 text-center text-sm font-bold text-white shadow-lg transition-transform active:scale-95"
                style={{ backgroundColor: platformColor }}
              >
                ▶ Ver ahora en {label}
              </button>

              {/* Me gustó · Ver hoy (carrito) · Ver luego */}
              <div className="flex gap-2">
                <button
                  onClick={() => toggleLike(current)}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2.5 text-[11px] font-semibold backdrop-blur-sm transition-all active:scale-95", liked.has(current.title) ? "border-primary bg-primary/25 text-white" : "border-white/20 bg-black/40 text-white/90")}
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> {liked.has(current.title) ? "¡Gustó!" : "Me gustó"}
                </button>
                <button
                  onClick={() => toggleCart(current)}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2.5 text-[11px] font-semibold backdrop-blur-sm transition-all active:scale-95", inCart(current.title) ? "border-primary bg-primary/30 text-white" : "border-white/20 bg-black/40 text-white/90")}
                >
                  {inCart(current.title) ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} Ver hoy
                </button>
                <button
                  onClick={() => toggleWatchlist(current)}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2.5 text-[11px] font-semibold backdrop-blur-sm transition-all active:scale-95", watchlisted.has(current.title) ? "border-amber-500 bg-amber-500/25 text-amber-300" : "border-white/20 bg-black/40 text-white/90")}
                >
                  <Bookmark className="h-3.5 w-3.5" /> Ver luego
                </button>
              </div>
            </div>
          </div>

          {/* Dots del carrusel del héroe + hint */}
          {heroItems.length > 1 && (
            <>
              <div className="mt-3 flex items-center justify-center gap-1.5">
                {heroItems.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(i)}
                    aria-label={`Opción ${i + 1} de ${heroItems.length}`}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      i === heroIndex ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30",
                    )}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
                {`Deslizá para ver las ${heroItems.length} mejores`}
              </p>
            </>
          )}

          {/* (La tira chica "Para ver hoy" se quitó: las tarjetas grandes de arriba
              ahora muestran el carrito en detalle cuando tiene ítems.) */}

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
            {galleryLoading && (
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
