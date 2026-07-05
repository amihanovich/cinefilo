import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRecommendation, fetchPosters, warmupBackend, type Message } from "./lib/api";
import { fetchTvHome, fetchTvHomeMore } from "./lib/tv-home";
import { jwSearch, type JwResult } from "./lib/justwatch";
import { launchOnTv } from "./lib/tv-launcher";
import { detectCountry, getCountry } from "./lib/tv-utils";
import { track } from "./lib/analytics";
import { recoToDeck, mediaToDeck, tvHomeToDeck, deckToMedia, type DeckItem } from "./lib/media";
import { useTvSession } from "./hooks/useTvSession";
import type { DpadBridge } from "./hooks/useDpad";
import { App as CapacitorApp } from "@capacitor/app";
import type { MediaItem } from "./lib/tv-protocol";
import { PairingScreen } from "./screens/PairingScreen";
import { PlatformsScreen } from "./screens/PlatformsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { DetailScreen } from "./screens/DetailScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { LaunchHintOverlay } from "./components/LaunchHintOverlay";

const PLATFORMS = ["Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Paramount+"];
const PLATFORMS_KEY = "cinefilo:tv:platforms";
const REC_SECTION = "Recomendadas para vos";

type Screen = "pairing" | "platforms" | "home" | "cards" | "detail";

export default function App() {
  const [screen, setScreen] = useState<Screen>("pairing");
  const [platforms, setPlatforms] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  // Deck de resultados IA (cards)
  const [items, setItems] = useState<DeckItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Home
  const [homeRecs, setHomeRecs] = useState<DeckItem[]>([]);
  const [homeLatest, setHomeLatest] = useState<DeckItem[]>([]);
  const [homeExplore, setHomeExplore] = useState<DeckItem[]>([]);
  const [homeFocusedId, setHomeFocusedId] = useState<string | null>(null);

  // Detalle
  const [detailItem, setDetailItem] = useState<DeckItem | null>(null);

  // Compartidos (keyed por título)
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchHint, setLaunchHint] = useState<{ title: string; platform: string } | null>(null);

  // Home aplanado + dedupeado por id (para lookups del teléfono + emitir SCREEN).
  const heroItem = homeRecs[0] ?? homeLatest[0] ?? null;
  const recsRail = useMemo(() => homeRecs.slice(1), [homeRecs]);
  const homeItems = useMemo(() => {
    const seen = new Set<string>();
    const out: DeckItem[] = [];
    for (const d of [...homeRecs, ...homeLatest, ...homeExplore]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
    return out;
  }, [homeRecs, homeLatest, homeExplore]);

  // Refs para leer estado actual dentro de handlers estables (comandos del teléfono).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const homeItemsRef = useRef(homeItems);
  homeItemsRef.current = homeItems;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const bridgeRef = useRef<DpadBridge | null>(null);

  const goBack = () => {
    const s = screenRef.current;
    if (s === "detail") setScreen("home");
    else if (s === "cards") setScreen("home");
    else if (s === "home") setScreen("platforms");
    else if (s === "platforms") setScreen("pairing");
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

  const fetchPostersInto = (deck: DeckItem[]) =>
    fetchPosters(deck.map((d) => ({ title: d.title, type: d.type, year: d.year }))).then((m) =>
      setPosters((prev) => ({ ...prev, ...m })),
    );

  // ── Home ──────────────────────────────────────────────────────────────────
  const homeLoadedRef = useRef(false);
  const loadHome = async () => {
    if (homeLoadedRef.current) return;
    homeLoadedRef.current = true;
    const raw = await fetchTvHome();
    if (raw.length === 0) {
      homeLoadedRef.current = false; // permitir reintento
      return;
    }
    const recs = raw.filter((i) => i.section === REC_SECTION).map(tvHomeToDeck);
    const latest = raw.filter((i) => i.section !== REC_SECTION).map(tvHomeToDeck);
    // Fallback si el backend no mandó secciones: partir a la mitad.
    const finalRecs = recs.length ? recs : latest.slice(0, Math.ceil(latest.length / 2));
    const finalLatest = recs.length ? latest : latest.slice(Math.ceil(latest.length / 2));
    setHomeRecs(finalRecs);
    setHomeLatest(finalLatest);
    rememberShown([...finalRecs, ...finalLatest]);
    void fetchPostersInto(finalRecs); // hero + recs primero
    void fetchPostersInto(finalLatest);
    const hero = finalRecs[0] ?? finalLatest[0];
    if (hero) void loadAvailability([hero]);
  };

  // Pre-warm en platforms + asegurar en home (guard interno → corre una vez).
  useEffect(() => {
    if (screen === "platforms" || screen === "home") void loadHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const exploreLoadingRef = useRef(false);
  const loadMoreExplore = async () => {
    if (exploreLoadingRef.current) return;
    exploreLoadingRef.current = true;
    try {
      const exclude = [
        ...new Set([...homeItemsRef.current.map((d) => d.title), ...shownTitlesRef.current]),
      ].slice(-40);
      const more = (await fetchTvHomeMore(exclude)).map(tvHomeToDeck);
      const existing = new Set(homeItemsRef.current.map((d) => d.id));
      const toAdd = more.filter((d) => !existing.has(d.id));
      if (toAdd.length > 0) {
        rememberShown(toAdd);
        setHomeExplore((prev) => [...prev, ...toAdd]);
        void fetchPostersInto(toAdd);
      }
    } finally {
      exploreLoadingRef.current = false;
    }
  };

  const openDetail = (item: DeckItem) => {
    setDetailItem(item);
    setScreen("detail");
    if (item.platform && availability[item.title] === undefined) void loadAvailability([item]);
    if (posters[item.title] === undefined) void fetchPostersInto([item]);
  };

  // ── Recomendación IA (chips / búsqueda del teléfono / "Más como esta") ──────
  const getReco = async (userQuery: string, extraExclude: string[] = []) => {
    setLoading(true);
    setLaunchHint(null);
    setScreen("cards");
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
      rememberShown(deck);
      setMessages([...newMessages, { role: "assistant", content: `Recomendé: ${deck.map((d) => d.title).join(", ")}.` }]);
      setItems(deck);
      setCurrentIndex(0);
      setLoading(false);

      track("recommendation_received", { platforms: effectivePlatforms });
      void fetchPostersInto(deck);
      void loadAvailability(deck);
    } catch (e) {
      console.error("[tv]", e);
      setLoading(false);
      showError("No pudimos buscar. Revisá tu conexión e intentá de nuevo.");
    }
  };

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
      void fetchPostersInto(toAdd);
      void loadAvailability(toAdd);
    } catch {
      /* silencioso */
    }
  };

  const launch = async (item: DeckItem) => {
    track("watch_now_tapped", { title: item.title, platform: item.platform });
    session.emitNowPlaying(deckToMedia(item, posters[item.title]));
    const result = await launchOnTv(item.title, item.platform, item.type);
    if (result === "manual") setLaunchHint({ title: item.title, platform: item.platform });
    else setLaunchHint(null);
  };

  const findById = (id: string): DeckItem | null =>
    itemsRef.current.find((d) => d.id === id) ?? homeItemsRef.current.find((d) => d.id === id) ?? null;

  // ── Handlers del control remoto (teléfono) ────────────────────────────────
  const session = useTvSession({
    onSearch: (query, exclude, liked, disliked) => {
      const hints =
        (liked.length ? ` (me gustaron: ${liked.slice(0, 8).join(", ")})` : "") +
        (disliked.length ? ` (evitá parecidas a: ${disliked.slice(0, 8).join(", ")})` : "");
      void getReco(query + hints, exclude);
    },
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
      if (screenRef.current === "home") {
        bridgeRef.current?.focusById?.(mediaId);
      } else {
        const idx = itemsRef.current.findIndex((d) => d.id === mediaId);
        if (idx >= 0) bridgeRef.current?.setFocus("alts", idx);
      }
    },
    onLoadMore: () => {
      if (screenRef.current === "home") void loadMoreExplore();
      else void loadMore();
    },
    onRemove: (mediaId) => {
      const item = findById(mediaId);
      if (item) shownTitlesRef.current.add(item.title);
      setItems((prev) => prev.filter((d) => d.id !== mediaId));
      setHomeRecs((prev) => prev.filter((d) => d.id !== mediaId));
      setHomeLatest((prev) => prev.filter((d) => d.id !== mediaId));
      setHomeExplore((prev) => prev.filter((d) => d.id !== mediaId));
      setCurrentIndex((i) => Math.max(0, Math.min(i, itemsRef.current.length - 2)));
    },
    onShowList: (mediaItems: MediaItem[]) => {
      const deck = mediaItems.map(mediaToDeck);
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

  // Sync con el teléfono: emitir SCREEN según la pantalla activa.
  useEffect(() => {
    if (!session.paired) return;
    if (screen === "cards") {
      const safeIndex = Math.min(currentIndex, Math.max(0, items.length - 1));
      const media = items.map((d) => deckToMedia(d, posters[d.title]));
      session.emitScreen(media, items[safeIndex]?.id ?? null);
    } else if (screen === "home") {
      const media = homeItems.map((d) => deckToMedia(d, posters[d.title]));
      session.emitScreen(media, homeFocusedId);
    }
    // detail: no se emite (el teléfono conserva su última lista).
  }, [session.paired, session.emitScreen, screen, items, currentIndex, posters, homeItems, homeFocusedId]);

  const handleContinueToHome = () => {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    track("wizard_complete", { platforms_count: platforms.length, platforms });
    setScreen("home");
  };

  const overlay = launchHint ? (
    <LaunchHintOverlay hint={launchHint} onDismiss={() => setLaunchHint(null)} />
  ) : null;

  if (screen === "pairing") {
    return (
      <>
        <PairingScreen
          qrUrl={session.qrUrl}
          paired={session.paired}
          connecting={session.connecting}
          onContinue={() => setScreen("platforms")}
          onBack={goBack}
          bridgeRef={bridgeRef}
        />
        {overlay}
      </>
    );
  }

  if (screen === "platforms") {
    return (
      <>
        <PlatformsScreen
          platforms={platforms}
          allPlatforms={PLATFORMS}
          loading={loading}
          error={error}
          onTogglePlatform={(p) =>
            setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
          }
          onStart={handleContinueToHome}
          onBack={goBack}
          bridgeRef={bridgeRef}
        />
        {overlay}
      </>
    );
  }

  if (screen === "home") {
    return (
      <>
        <HomeScreen
          heroItem={heroItem}
          recs={recsRail}
          latest={homeLatest}
          explore={homeExplore}
          posters={posters}
          availability={availability}
          paired={session.paired}
          onChip={(q) => void getReco(q)}
          onOpenDetail={openDetail}
          onPlayHero={(item) => void launch(item)}
          onLoadMoreExplore={() => void loadMoreExplore()}
          onFocusedItemChange={setHomeFocusedId}
          onBack={goBack}
          bridgeRef={bridgeRef}
        />
        {overlay}
      </>
    );
  }

  if (screen === "detail" && detailItem) {
    return (
      <>
        <DetailScreen
          item={detailItem}
          poster={posters[detailItem.title]}
          availability={availability[detailItem.title]}
          onPlay={(item) => void launch(item)}
          onMoreLikeThis={(item) => void getReco(`algo similar a ${item.title}`)}
          onBack={goBack}
          bridgeRef={bridgeRef}
        />
        {overlay}
      </>
    );
  }

  return (
    <>
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
        onBack={goBack}
        bridgeRef={bridgeRef}
      />
      {overlay}
    </>
  );
}
