import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent, type UIEvent as ReactUIEvent } from "react";
import {
  Sparkles, ChevronLeft, ChevronRight, Send, Mic,
  User, Bookmark, ThumbsUp, ThumbsDown, Copy, Check, LayoutGrid, Loader2, QrCode, X, Plus,
  Volume2, VolumeX, Keyboard, ChevronDown, ShoppingCart,
} from "lucide-react";
import { inferContext, contextToPromptHint, seasonHintShort } from "./lib/context";
import { fetchRecommendation, fetchPosters, warmupBackend } from "./lib/api";
import { isMuted, setMuted } from "./lib/tts";
import { colorForPlatform, platformLabel } from "./lib/deeplink";
import { jwSearch, openNative, openInApp } from "./lib/justwatch";
import { VoiceRecorder, transcribe } from "./lib/stt";
import { VoiceAgentOverlay } from "./components/VoiceAgent";
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
const WATCHLIST_KEY = "miru:watchlist";
// Ítems completos de "Mi lista" (el WATCHLIST_KEY guarda solo título/plataforma
// para el AccountSheet; acá va la Recommendation entera para restaurar la lista).
const MYLIST_ITEMS_KEY = "miru:mylist-items";
const LIKED_KEY = "miru:liked";
const DISLIKED_KEY = "miru:disliked";
// Star+ se fusionó con Disney+ en LatAm (2024) — ya no es seleccionable,
// pero los mapeos internos (color, label, deeplink) se mantienen para datos viejos.
const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];
const COUNTRY_KEY = "miru:country";
const PLATFORMS_KEY = "miru:platforms";
const TV_BANNER_KEY = "miru:tvBannerDismissed";
const OPENED_KEY = "miru:opened_before";

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

// (La heurística por regex isDetailQuery se reemplazó por /api/orb: la IA
// infiere si es pregunta de asesor o pedido de búsqueda — ver routeCore.)

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

  // "Mi lista" (ex carrito "Para hoy"): persistida en el dispositivo con los
  // ítems completos (póster/razón) para restaurarla entre sesiones, y en sync
  // con el store compartido miru:watchlist (lo que ve el AccountSheet).
  const [cart, setCart] = useState<Recommendation[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(MYLIST_ITEMS_KEY) ?? "[]") as Recommendation[];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false); // lista discreta expandible
  useEffect(() => {
    try {
      localStorage.setItem(MYLIST_ITEMS_KEY, JSON.stringify(cart.slice(0, 60)));
    } catch { /* noop */ }
  }, [cart]);
  const [chatOpen, setChatOpen] = useState(false); // buscador de texto (secundario) colapsado
  const [detailItem, setDetailItem] = useState<Recommendation | null>(null);
  // Lista de origen de la ficha (carrito o grilla) para poder deslizar ←/→ dentro de ella.
  const [detailList, setDetailList] = useState<Recommendation[]>([]);

  // Búsqueda en curso → pantalla de loading (Bloque 3). null = sin búsqueda activa.
  const [searchInfo, setSearchInfo] = useState<{ query: string; platforms: string[]; type: "auto" | "text" | "voice" } | null>(null);
  const [ttsMuted, setTtsMuted] = useState(() => { try { return isMuted(); } catch { return false; } });

  const toggleMute = () => {
    const next = !ttsMuted;
    setTtsMuted(next);
    setMuted(next); // persiste + corta lo que esté sonando si se mutea
  };

  // Chat / conversación
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState("");
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
  const [liked, setLiked] = useState<Set<string>>(() => loadSet(LIKED_KEY));
  const [disliked, setDisliked] = useState<Set<string>>(() => loadSet(DISLIKED_KEY));
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
    setLoading(true);
    const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
    // Feedback inmediato (≤100ms): plataformas activas + eco literal del pedido.
    // (Sin inferencia: era una llamada extra que agregaba latencia; el literal alcanza.)
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
        country: getCountry(),
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

      // MVP de voz: hablarle a Miru = buscar. Los resultados hablan solos —
      // ya no se reproduce la intro (cinephile_note sigue viniendo del backend,
      // dormida, por si se retoma el modo asesor).

      void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
      void loadAvailability(allItems);
      // "Más opciones": ESCALONADO. Antes se disparaba en paralelo con la reco
      // principal (2 llamadas pesadas a la vez) y saturaba red/backend, colgando la
      // app —sobre todo la 1ª vez con backend frío—. Ahora esperamos a que rindan la
      // reco principal + pósters y recién ahí cargamos la grilla, en segundo plano.
      setGalleryItems([]);
      galleryDryRef.current = false;
      setGalleryLoading(false);
      // Stagger corto: que el héroe pinte primero y la grilla entre enseguida. La
      // grilla ahora pide 6 alternativas (1200 tokens, rápida como la principal),
      // así que ya no compite fuerte — no hace falta el 1.5s de antes.
      window.setTimeout(() => { void loadGallery(); }, 400);
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
        // 6 alternativas → bajo el umbral >6 = 3500 tokens. Evita la 2ª
        // generación pesada que colgaba "más opciones" 5-6s. La carga infinita
        // sigue trayendo más tandas al scrollear.
        alternativesCount: 6,
        country: getCountry(),
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
        alternativesCount: 6,
        country: getCountry(),
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

  // ── Ruteo unificado (LA LEY de la voz/chat, versión MVP) ──────────────────
  // Todo lo que el usuario dice o escribe es SIEMPRE un pedido de búsqueda:
  // rueda de plataformas + recomendaciones nuevas, con el LITERAL de lo dicho.
  // (La capa conversacional —/api/orb, asesor, mayéutica— quedó dormida en el
  // backend por si se retoma.)
  const routeUserInput = async (text: string, source: "text" | "voice") => {
    const turnNumber = messages.filter((m) => m.role === "user").length + 1;
    track("refinement_made", { turn_number: turnNumber });
    await getReco(text, source);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || loading) return;
    setChatText("");
    await routeUserInput(text, "text");
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
        // Misma ley que el orbe: hablaste → Miru decide (pregunta o búsqueda)
        // y actúa. Ya no es solo dictado al input.
        const text = (await transcribe(blob)).trim();
        if (text) await routeUserInput(text, "voice");
        else showError("No te escuché. Probá de nuevo.");
      } catch {
        showError("No te escuché. Probá de nuevo.");
      }
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

  // ── Acciones de cards ─────────────────────────────────────────────────────

  const toggleLike = (item: Recommendation) => {
    const isIn = liked.has(item.title);
    setLiked((prev) => { const n = new Set(prev); isIn ? n.delete(item.title) : n.add(item.title); return n; });
    if (isIn) removeFromStore(LIKED_KEY, item.title);
    else {
      addToStore(LIKED_KEY, { title: item.title, platform: item.platform, type: item.type });
      track("liked", { title: item.title, platform: item.platform });
      // Mutuamente excluyente con "no me gustó".
      if (disliked.has(item.title)) { setDisliked((prev) => { const n = new Set(prev); n.delete(item.title); return n; }); removeFromStore(DISLIKED_KEY, item.title); }
    }
  };

  const toggleDislike = (item: Recommendation) => {
    const isIn = disliked.has(item.title);
    setDisliked((prev) => { const n = new Set(prev); isIn ? n.delete(item.title) : n.add(item.title); return n; });
    if (isIn) removeFromStore(DISLIKED_KEY, item.title);
    else {
      addToStore(DISLIKED_KEY, { title: item.title, platform: item.platform, type: item.type });
      track("disliked", { title: item.title, platform: item.platform });
      if (liked.has(item.title)) { setLiked((prev) => { const n = new Set(prev); n.delete(item.title); return n; }); removeFromStore(LIKED_KEY, item.title); }
    }
  };

  const copyTitle = (title: string, platform: string) => {
    void navigator.clipboard.writeText(title).then(() => {
      setCopied(true);
      track("title_copied", { title, platform });
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const openStreaming = async (current: Recommendation, avail: JwResult | undefined) => {
    track("watch_now_tapped", {
      title: current.title,
      platform: current.platform,
      availability_confirmed: !!avail?.confirmed,
    });
    // Si hay disponibilidad confirmada, intentamos abrir la app/URL exacta. Si eso
    // no logra abrir NADA (p.ej. sin standardWebURL ni deeplink), caemos al fallback
    // web de la plataforma para que el botón nunca quede sin reaccionar.
    if (avail?.confirmed && (await openNative(avail))) return;

    const q = encodeURIComponent(current.title);

    // JustWatch verificó y el título NO está en esa plataforma: abrir su app
    // igual era mandar al usuario a un "sin resultados". Mejor una búsqueda
    // neutral de dónde verlo — directo con window.open: openInApp intentaría
    // el scheme nativo de esa misma app equivocada. (avail === undefined =
    // sin verificar: se abre la plataforma como siempre.)
    if (avail && !avail.confirmed) {
      window.open(`https://www.google.com/search?q=${q}+ver+online`, "_system");
      return;
    }
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
  };

  // ── "Mi lista" + long-press de la grilla ──────────────────────────────────
  const inCart = (title: string) => cart.some((c) => c.title === title);
  const toggleCart = (item: Recommendation) => {
    const adding = !cart.some((c) => c.title === item.title);
    setCart((prev) =>
      prev.some((c) => c.title === item.title)
        ? prev.filter((c) => c.title !== item.title)
        : [item, ...prev],
    );
    // "Mi lista" es UNA sola: el store compartido (AccountSheet) va en sync.
    if (adding) {
      addToStore(WATCHLIST_KEY, { title: item.title, platform: item.platform, type: item.type });
      track("saved", { title: item.title, platform: item.platform });
      // Al sumar, abrimos la lista discreta para dar feedback (el hero NO salta).
      setCartOpen(true);
    } else {
      removeFromStore(WATCHLIST_KEY, item.title);
    }
  };
  const removeFromCart = (title: string) => {
    removeFromStore(WATCHLIST_KEY, title);
    setCart((prev) => prev.filter((c) => c.title !== title));
  };

  // Abre la ficha guardando su lista de origen (carrito o grilla) para poder
  // deslizar ←/→ dentro de ella (la ficha es un "zoom" de esa lista).
  const openDetail = (item: Recommendation, list: Recommendation[]) => {
    setDetailList(list.some((i) => i.title === item.title) ? list : [item]);
    setDetailItem(item);
  };
  // Navegar dentro de la lista de origen de la ficha.
  const detailGo = (delta: number) => {
    if (!detailItem || detailList.length <= 1) return;
    const idx = detailList.findIndex((d) => d.title === detailItem.title);
    if (idx < 0) return;
    const next = Math.min(detailList.length - 1, Math.max(0, idx + delta));
    if (next !== idx) setDetailItem(detailList[next]);
  };
  const onDetailTouchStart = (e: ReactTouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onDetailTouchEnd = (e: ReactTouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    detailGo(dx < 0 ? 1 : -1);
  };

  // Interacción con las tarjetas: 1 tap = acción corta (ej. guardar en el carrito);
  // DOBLE tap = abrir la ficha ("zoom"). Desambiguamos con una ventana de 280ms.
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTapRef = useRef<{ title: string; fire: () => void } | null>(null);
  const lastTapRef = useRef<{ title: string; t: number }>({ title: "", t: 0 });
  const DBL_TAP_MS = 280;
  // Regla de tapping: 1 tap = ver la ficha (el gesto natural de "ver más");
  // doble tap = la acción rápida que pase por onDouble (guardar en Mi lista).
  const handleCardTap = (item: Recommendation, list: Recommendation[], onDouble?: () => void) => {
    const now = Date.now();
    const prev = lastTapRef.current;
    if (prev.title === item.title && now - prev.t < DBL_TAP_MS) {
      // Doble tap → guardar (cancela la apertura de ficha pendiente).
      if (singleTapTimerRef.current) { clearTimeout(singleTapTimerRef.current); singleTapTimerRef.current = null; }
      pendingTapRef.current = null;
      lastTapRef.current = { title: "", t: 0 };
      if (onDouble) onDouble();
      return;
    }
    // Tap sobre OTRA tarjeta con una apertura pendiente: cancelarla a secas —
    // el usuario cambió de tarjeta, abrir la ficha vieja sería un salto raro.
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
      pendingTapRef.current = null;
    }
    lastTapRef.current = { title: item.title, t: now };
    const openThis = () => openDetail(item, list);
    pendingTapRef.current = { title: item.title, fire: openThis };
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      pendingTapRef.current = null;
      openThis();
    }, DBL_TAP_MS);
  };
  // Doble tap dentro de la ficha (sobre el póster) = volver.
  const fichaTapRef = useRef(0);
  const onFichaDoubleTap = () => {
    const now = Date.now();
    if (now - fichaTapRef.current < DBL_TAP_MS) { fichaTapRef.current = 0; setDetailItem(null); }
    else fichaTapRef.current = now;
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
        firstTime={true} /* Miru te recibe en CADA apertura (no solo la 1ª) */
        busy={loading}
        error={error}
        onSubmit={(text) => { localStorage.setItem(OPENED_KEY, "1"); void getReco(text, "text"); }}
        onSurprise={() => { localStorage.setItem(OPENED_KEY, "1"); handleStartReco(); }}
        onConnectTv={() => void openTvRemote()}
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
    // El héroe muestra SIEMPRE las recomendaciones de Miru (top-5), sin importar
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

        {/* (El banner promo dummy de "Miru para tu TV" se quitó: la entrada a
            la TV es el botón "TV" del header, que abre el escáner del QR.) */}

        {voiceMode && (
          <VoiceAgentOverlay
            /* MVP: al frenar, lo dicho SIEMPRE dispara la búsqueda — la rueda
               (SearchLoading) reemplaza la pantalla y el overlay se desmonta. */
            onSearch={(text) => void getReco(text, "voice")}
            onDismiss={() => setVoiceMode(false)}
          />
        )}

        {/* Header: logo a la izquierda; "Conecta la TV" (con QR) + "Mi cuenta" a la derecha */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-6 pb-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-base font-bold text-foreground">Miru</span>
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

        {/* Acción principal: Pedile a Miru (voz) + escribir (texto, secundario) + mute */}
        <div className="shrink-0 px-5 pt-3 pb-3 flex items-center gap-2">
          <button
            onClick={() => { track("voice_used"); setVoiceMode(true); }}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 py-3 transition-all active:scale-95"
          >
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
              <Orb phase="idle" size="mini" />
            </span>
            <span className="text-sm font-semibold text-primary">Pedile a Miru</span>
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
            aria-label={ttsMuted ? "Activar la voz de Miru" : "Silenciar la voz de Miru"}
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
                placeholder={micRecording ? "Escuchando..." : loading ? "Buscando..." : "Más oscuro · ¿de qué trata? · otra cosa..."}
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

        {/* Contenido en scroll continuo: héroe + carrito + grilla (con carga infinita) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8" onScroll={onGridScroll}>
          {/* Tarjetas grandes (cinematográficas): póster de fondo + info sobre gradiente.
              SIEMPRE las recomendaciones de Miru (top-5), swipe ←/→. */}
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

            {/* Flechas ←/→ (deslizar entre las 5) — plantadas abajo, en el hueco entre
                "Ver ahora" y los botones, para NO tapar la razón de la recomendación. */}
            {heroItems.length > 1 && (
              <>
                {heroIndex > 0 && (
                  <button
                    onClick={() => navigate(heroIndex - 1)}
                    aria-label="Anterior"
                    className="absolute bottom-[70px] left-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm active:scale-90"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                {heroIndex < heroItems.length - 1 && (
                  <button
                    onClick={() => navigate(heroIndex + 1)}
                    aria-label="Siguiente"
                    className="absolute bottom-[70px] right-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm active:scale-90"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </>
            )}

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
              </div>

              <p className="text-[13px] leading-relaxed text-white/85 line-clamp-3">{current.reason}</p>

              <button
                onClick={() => openStreaming(current, avail)}
                className="mt-1 w-full rounded-full py-3 text-center text-sm font-bold text-white shadow-lg transition-transform active:scale-95"
                style={{ backgroundColor: platformColor }}
              >
                ▶ Ver ahora en {label}
              </button>
              {/* Atribución requerida por TMDB: la disponibilidad es data de JustWatch */}
              <span className="text-center text-[9px] text-white/40">Disponibilidad: JustWatch</span>

              {/* 👍 · 👎 (solo íconos) · + Mi lista. */}
              <div className="flex gap-2">
                <button
                  onClick={() => toggleLike(current)}
                  aria-label="Me gustó"
                  className={cn("flex items-center justify-center rounded-full border px-4 py-2.5 backdrop-blur-sm transition-all active:scale-95", liked.has(current.title) ? "border-primary bg-primary/30 text-white" : "border-white/20 bg-black/40 text-white/90")}
                >
                  <ThumbsUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => toggleDislike(current)}
                  aria-label="No me gustó"
                  className={cn("flex items-center justify-center rounded-full border px-4 py-2.5 backdrop-blur-sm transition-all active:scale-95", disliked.has(current.title) ? "border-red-500 bg-red-500/30 text-white" : "border-white/20 bg-black/40 text-white/90")}
                >
                  <ThumbsDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => toggleCart(current)}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2.5 text-[12px] font-semibold backdrop-blur-sm transition-all active:scale-95", inCart(current.title) ? "border-primary bg-primary/30 text-white" : "border-white/20 bg-black/40 text-white/90")}
                >
                  {inCart(current.title) ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {inCart(current.title) ? "En Mi lista" : "Mi lista"}
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

          {/* "Mi lista" — discreta y expandible, debajo del héroe y arriba
              de la grilla. No invade las recomendaciones. */}
          {cart.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setCartOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] font-semibold text-foreground active:scale-95 transition-transform"
                aria-label={cartOpen ? "Ocultar Mi lista" : "Ver Mi lista"}
              >
                <ShoppingCart className="h-3.5 w-3.5 text-primary" />
{cart.length} en Mi lista
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", cartOpen && "rotate-180")} />
              </button>

              {cartOpen && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {cart.map((c) => {
                    const p = posterFor(c.title);
                    return (
                      <div key={c.title} className="relative w-14 shrink-0">
                        <button
                          onClick={() => openDetail(c, cart)}
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
              {cartOpen && cart.length > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground/60">Tocá para ver la ficha · la ✕ la quita</p>
              )}
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
                  onClick={() => handleCardTap(item, gridItems, () => toggleCart(item))}
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
1 toque = ver la ficha · 2 toques = guardar en Mi lista
            </p>
          )}
        </div>

        {/* Ficha — swipeable dentro de su lista de origen (carrito o grilla) */}
        {detailItem && (() => {
          const dIdx = detailList.findIndex((d) => d.title === detailItem.title);
          const dTotal = detailList.length;
          const canNav = dTotal > 1 && dIdx >= 0;
          return (
            <div className="fixed inset-0 z-50 flex flex-col bg-background safe-top safe-bottom">
              <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
                <button onClick={() => setDetailItem(null)} className="flex h-9 items-center gap-1 rounded-full bg-muted px-3 text-muted-foreground active:scale-90" aria-label="Volver">
                  <ChevronLeft className="h-5 w-5" /> <span className="text-sm font-semibold">Volver</span>
                </button>
                <p className="text-base font-bold text-foreground">Ficha</p>
                {canNav && <span className="ml-auto text-xs font-semibold text-muted-foreground">{dIdx + 1} / {dTotal}</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-5" onTouchStart={onDetailTouchStart} onTouchEnd={onDetailTouchEnd}>
                <div className="relative overflow-hidden rounded-2xl border border-border bg-muted/30" onClick={onFichaDoubleTap}>
                  <div className="h-56 w-full overflow-hidden bg-muted">
                    {posterFor(detailItem.title) ? (
                      <img src={posterFor(detailItem.title)!} alt={detailItem.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  {/* Flechas prev/next sobre el póster */}
                  {canNav && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); detailGo(-1); }}
                        disabled={dIdx === 0}
                        className="absolute left-2 top-28 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-90 disabled:opacity-25"
                        aria-label="Anterior"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); detailGo(1); }}
                        disabled={dIdx === dTotal - 1}
                        className="absolute right-2 top-28 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-90 disabled:opacity-25"
                        aria-label="Siguiente"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                  <div className="p-4">
                    <h2 className="text-xl font-bold text-foreground">{detailItem.title}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: colorForPlatform(detailItem.platform) }}>{platformLabel(detailItem.platform)}</span>
                      <span className="text-[11px] text-muted-foreground">{detailItem.type} · {detailItem.duration}{detailItem.year && ` · ${detailItem.year}`}</span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-foreground/75">{detailItem.reason}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); void openStreaming(detailItem, availability[detailItem.title]); }}
                      className="mt-4 w-full rounded-full py-3 text-center text-sm font-bold text-white active:scale-95"
                      style={{ backgroundColor: colorForPlatform(detailItem.platform) }}
                    >
                      ▶ Ver ahora en {platformLabel(detailItem.platform)}
                    </button>
                    {/* Atribución requerida por TMDB: la disponibilidad es data de JustWatch */}
                    <p className="mt-1 text-center text-[9px] text-muted-foreground/60">Disponibilidad: JustWatch</p>
                    {/* Un solo botón de guardado: "Mi lista" (antes convivían
                        "Para hoy" y "Ver más tarde" — dos listas para lo mismo). */}
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCart(detailItem); }}
                        className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2.5 text-[13px] font-semibold active:scale-95", inCart(detailItem.title) ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground")}
                      >
                        {inCart(detailItem.title) ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                        {inCart(detailItem.title) ? "En Mi lista" : "Mi lista"}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-center text-[10px] text-muted-foreground/60">
                  {canNav ? `Deslizá ←/→ para ver las ${dTotal} · ` : ""}Tocá dos veces el póster o "Volver" para salir
                </p>
              </div>
            </div>
          );
        })()}
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
