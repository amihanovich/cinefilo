import { useEffect, useRef, useState } from "react";
import { fetchRecommendation, fetchPosters, warmupBackend, type Recommendation, type Message } from "./lib/api";
import { jwSearch, type JwResult } from "./lib/justwatch";
import { launchOnTv } from "./lib/tv-launcher";
import { detectCountry, getCountry } from "./lib/tv-utils";
import { track } from "./lib/analytics";
import { recoToDeck, mediaToDeck, deckToMedia, type DeckItem } from "./lib/media";
import { useTvSession } from "./hooks/useTvSession";
import type { DpadBridge } from "./hooks/useDpad";
import { App as CapacitorApp } from "@capacitor/app";
import type { MediaItem } from "./lib/tv-protocol";
import { PairingScreen } from "./screens/PairingScreen";
import { PlatformsScreen } from "./screens/PlatformsScreen";
import { CardsScreen } from "./screens/CardsScreen";

// Star+ se fusionó con Disney+ en LatAm (2024) — mismo criterio que el móvil.
const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];
const PLATFORMS_KEY = "cinefilo:tv:platforms";

type Screen = "pairing" | "platforms" | "cards";

export default function App() {
  const [screen, setScreen] = useState<Screen>("pairing");
  const [platforms, setPlatforms] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  // Deck en pantalla
  const [items, setItems] = useState<DeckItem[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchHint, setLaunchHint] = useState<{ title: string; platform: string } | null>(null);

  // Refs para leer estado actual dentro de handlers estables (comandos del teléfono).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const indexRef = useRef(currentIndex);
  indexRef.current = currentIndex;

  // Bridge hacia el dpad de la pantalla activa: App reenvía acá los comandos
  // del teléfono (NAVIGATE/FOCUS/SELECT) para que compartan camino con el
  // control remoto físico. Cada pantalla escribe su API al montarse.
  const bridgeRef = useRef<DpadBridge | null>(null);

  // Back unificado (teléfono BACK + control físico): cards→platforms→pairing→salir.
  const goBack = () => {
    if (screenRef.current === "cards") setScreen("platforms");
    else if (screenRef.current === "platforms") setScreen("pairing");
    else void CapacitorApp.exitApp();
  };

  const shownTitlesRef = useRef<Set<string>>(new Set());
  const rememberShown = (recos: DeckItem[]) => {
    for (const r of recos) shownTitlesRef.current.add(r.title);
  };
  const excludeList = (extra: string[] = []) =>
    [...new Set([...shownTitlesRef.current, ...extra])].slice(-40);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  useEffect(() => {
    void detectCountry();
    warmupBackend();
  }, []);

  const loadAvailability = async (deck: DeckItem[]) => {
    const country = getCountry();
    await Promise.allSettled(
      deck.map(async (item) => {
        if (!item.platform) return;
        const result = await jwSearch(item.title, item.platform, item.type, country);
        setAvailability((prev) => ({ ...prev, [item.title]: result }));
      }),
    );
  };

  // Núcleo: pide recomendaciones (auto, texto o voz desde el teléfono).
  const getReco = async (userQuery: string, extraExclude: string[] = []) => {
    setLoading(true);
    setLaunchHint(null);
    const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
    const newMessages: Message[] = [...messages, { role: "user", content: userQuery }];

    try {
      const data = await fetchRecommendation({
        messages: newMessages,
        platforms: effectivePlatforms,
        contextHint: null,
        seasonHint: null,
        weatherHint: null,
        excludeTitles: excludeList(extraExclude),
        alternativesCount: 4,
      });

      if (!data?.main) throw new Error("Sin resultado");

      const deck = [data.main, ...(data.alternatives ?? []).slice(0, 4)].map(recoToDeck);
      const assistantSummary = `Recomendé: ${deck.map((d) => d.title).join(", ")}.`;

      rememberShown(deck);
      setMessages([...newMessages, { role: "assistant", content: assistantSummary }]);
      setItems(deck);
      setPosters({});
      setAvailability({});
      setCurrentIndex(0);
      setScreen("cards");
      setLoading(false);

      track("recommendation_received", { platforms: effectivePlatforms });

      void fetchPosters(deck.map((d) => ({ title: d.title, type: d.type, year: d.year }))).then(setPosters);
      void loadAvailability(deck);
    } catch (e) {
      console.error("[tv]", e);
      setLoading(false);
      showError("No pudimos buscar. Revisá tu conexión e intentá de nuevo.");
    }
  };

  // LOAD_MORE: pide más y las agrega al final (dedup por id).
  const loadMore = async () => {
    const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
    try {
      const data = await fetchRecommendation({
        messages: [...messages, { role: "user", content: "Mostrame más opciones variadas" }],
        platforms: effectivePlatforms,
        contextHint: null,
        seasonHint: null,
        weatherHint: null,
        excludeTitles: excludeList(),
        alternativesCount: 6,
      });
      if (!data?.main) return;
      const fresh = [data.main, ...(data.alternatives ?? [])].map(recoToDeck);
      const existing = new Set(itemsRef.current.map((d) => d.id));
      const toAdd = fresh.filter((d) => !existing.has(d.id));
      if (toAdd.length === 0) return;
      rememberShown(toAdd);
      setItems((prev) => [...prev, ...toAdd]);
      void fetchPosters(toAdd.map((d) => ({ title: d.title, type: d.type, year: d.year }))).then((m) =>
        setPosters((prev) => ({ ...prev, ...m })),
      );
      void loadAvailability(toAdd);
    } catch {
      /* silencioso — el teléfono limpia su "cargando más" por timeout */
    }
  };

  const launch = async (item: DeckItem) => {
    track("watch_now_tapped", { title: item.title, platform: item.platform });
    // El teléfono muestra "▶ título" apenas lanzamos.
    session.emitNowPlaying(deckToMedia(item, posters[item.title]));
    const result = await launchOnTv(item.title, item.platform, item.type);
    if (result === "manual") setLaunchHint({ title: item.title, platform: item.platform });
    else setLaunchHint(null);
  };

  const findById = (id: string) => itemsRef.current.find((d) => d.id === id) ?? null;

  // ── Handlers del control remoto (teléfono) ────────────────────────────────
  const session = useTvSession({
    onSearch: (query, exclude, liked, disliked) => {
      const hints =
        (liked.length ? ` (me gustaron: ${liked.slice(0, 8).join(", ")})` : "") +
        (disliked.length ? ` (evitá parecidas a: ${disliked.slice(0, 8).join(", ")})` : "");
      void getReco(query + hints, exclude);
    },
    // NAVIGATE / SELECT / FOCUS del teléfono se reenvían al MISMO dpad que usa
    // el control remoto físico (bridge) → un solo camino de código para ambos.
    onNavigate: (direction) => bridgeRef.current?.move(direction),
    onSelect: (mediaId) => {
      if (mediaId) {
        const item = findById(mediaId);
        if (item) void launch(item);
      } else {
        bridgeRef.current?.select();
      }
    },
    onPlay: (mediaId) => {
      const item = findById(mediaId);
      if (item) void launch(item);
    },
    onFocus: (mediaId) => {
      const idx = itemsRef.current.findIndex((d) => d.id === mediaId);
      if (idx >= 0) bridgeRef.current?.setFocus("alts", idx);
    },
    onLoadMore: () => void loadMore(),
    onRemove: (mediaId) => {
      const item = findById(mediaId);
      if (item) shownTitlesRef.current.add(item.title); // no volver a recomendarla
      setItems((prev) => prev.filter((d) => d.id !== mediaId));
      setCurrentIndex((i) => Math.max(0, Math.min(i, itemsRef.current.length - 2)));
    },
    onShowList: (mediaItems: MediaItem[]) => {
      const deck = mediaItems.map(mediaToDeck);
      // Sembramos los posters que ya trae el teléfono (evita re-fetch).
      const seededPosters: Record<string, string | null> = {};
      for (const m of mediaItems) if (m.posterUrl) seededPosters[m.title] = m.posterUrl;
      setItems(deck);
      setPosters((prev) => ({ ...prev, ...seededPosters }));
      setCurrentIndex(0);
      setScreen("cards");
      void loadAvailability(deck);
    },
    onBack: goBack,
  });

  // Mantener al teléfono en sync: emitir SCREEN cuando cambia el deck / foco /
  // posters, o cuando se acaba de emparejar (para que un teléfono recién
  // conectado vea lo que hay en pantalla).
  useEffect(() => {
    if (!session.paired || screen !== "cards") return;
    const safeIndex = Math.min(currentIndex, Math.max(0, items.length - 1));
    const media = items.map((d) => deckToMedia(d, posters[d.title]));
    session.emitScreen(media, items[safeIndex]?.id ?? null);
    // Deps a los valores estables (no al objeto session, que es nuevo cada render).
  }, [session.paired, session.emitScreen, screen, items, currentIndex, posters]);

  const handleStartReco = () => {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    track("wizard_complete", { platforms_count: platforms.length, platforms });
    void getReco("lo mejor para esta noche");
  };

  if (screen === "pairing") {
    return (
      <PairingScreen
        qrUrl={session.qrUrl}
        paired={session.paired}
        connecting={session.connecting}
        onContinue={() => setScreen("platforms")}
        onBack={goBack}
        bridgeRef={bridgeRef}
      />
    );
  }

  if (screen === "platforms") {
    return (
      <PlatformsScreen
        platforms={platforms}
        allPlatforms={PLATFORMS}
        loading={loading}
        error={error}
        onTogglePlatform={(p) =>
          setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
        }
        onStart={handleStartReco}
        onBack={goBack}
        bridgeRef={bridgeRef}
      />
    );
  }

  return (
    <CardsScreen
      items={items}
      posters={posters}
      availability={availability}
      currentIndex={currentIndex}
      onNavigate={setCurrentIndex}
      onPlay={(item) => void launch(item)}
      loading={loading}
      error={error}
      paired={session.paired}
      launchHint={launchHint}
      onDismissHint={() => setLaunchHint(null)}
      onBack={goBack}
      bridgeRef={bridgeRef}
    />
  );
}
