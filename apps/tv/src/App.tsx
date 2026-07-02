import { useEffect, useRef, useState } from "react";
import { fetchRecommendation, fetchPosters, warmupBackend, type Recommendation, type Message } from "./lib/api";
import { jwSearch, type JwResult } from "./lib/justwatch";
import { detectCountry, getCountry } from "./lib/tv-utils";
import { track } from "./lib/analytics";
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

  // Cards
  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [availability, setAvailability] = useState<Record<string, JwResult>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Todos los títulos ya mostrados en la sesión — evita que la IA repita
  // recomendaciones de búsquedas/refinamientos anteriores.
  const shownTitlesRef = useRef<Set<string>>(new Set());
  const rememberShown = (recos: Recommendation[]) => {
    for (const r of recos) shownTitlesRef.current.add(r.title);
  };
  const excludeList = () => [...shownTitlesRef.current].slice(-40);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  // Despertar Railway + detectar país apenas arranca la app.
  useEffect(() => {
    void detectCountry();
    warmupBackend();
  }, []);

  const loadAvailability = async (allItems: Recommendation[]) => {
    const country = getCountry();
    await Promise.allSettled(
      allItems.map(async (item) => {
        const result = await jwSearch(item.title, item.platform, item.type, country);
        setAvailability((prev) => ({ ...prev, [item.title]: result }));
      }),
    );
  };

  const getReco = async (userQuery: string) => {
    setLoading(true);
    const effectivePlatforms = platforms.length > 0 ? platforms : PLATFORMS;
    const newMessages: Message[] = [...messages, { role: "user", content: userQuery }];

    try {
      const data = await fetchRecommendation({
        messages: newMessages,
        platforms: effectivePlatforms,
        contextHint: null,
        seasonHint: null,
        weatherHint: null,
        excludeTitles: excludeList(),
        alternativesCount: 4,
      });

      if (!data?.main) throw new Error("Sin resultado");

      const allItems = [data.main, ...(data.alternatives ?? []).slice(0, 4)];
      const assistantSummary = `Recomendé: ${data.main.title} y ${(data.alternatives ?? [])
        .slice(0, 4)
        .map((a) => a.title)
        .join(", ")}.`;

      rememberShown(allItems);
      setMessages([...newMessages, { role: "assistant", content: assistantSummary }]);
      setItems(allItems);
      setPosters({});
      setAvailability({});
      setCurrentIndex(0);
      setScreen("cards");
      setLoading(false);

      track("recommendation_received", { platforms: effectivePlatforms });

      void fetchPosters(allItems.map((i) => ({ title: i.title, type: i.type, year: i.year }))).then(setPosters);
      void loadAvailability(allItems);
    } catch (e) {
      console.error("[tv]", e);
      setLoading(false);
      showError("No pudimos buscar. Revisá tu conexión e intentá de nuevo.");
    }
  };

  const handleStartReco = () => {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(platforms));
    track("wizard_complete", { platforms_count: platforms.length, platforms });
    void getReco("lo mejor para esta noche");
  };

  if (screen === "pairing") {
    return <PairingScreen onContinue={() => setScreen("platforms")} />;
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
      loading={loading}
      error={error}
    />
  );
}
