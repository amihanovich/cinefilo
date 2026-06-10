import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Play,
  CornerDownLeft,
  Tv,
  Loader2,
  Eye,
  Bookmark,
  BookmarkCheck,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";
import { useTvChannel } from "@/lib/use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "@/lib/tv-protocol";
import { colorForPlatform } from "@/lib/recommendations";
import { VoiceRecordButton } from "@/components/VoiceRecordButton";

export const Route = createFileRoute("/control")({
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : "",
  }),
  head: () => ({
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:wght@500;600&display=swap",
      },
    ],
  }),
  component: ControlPage,
});

const SERIF = "'Newsreader', Georgia, serif";
const SANS = "'Inter', system-ui, -apple-system, sans-serif";

// Paleta cálida tipo Anthropic.
const C = {
  bg: "#F7F4ED",
  surface: "#FFFFFF",
  border: "#E7E2D6",
  text: "#2B2A27",
  muted: "#8A8678",
  accent: "#CC785C",
  placeholder: "#A39E91",
  posterBg: "#EFEBE0",
};

// --- Persistencia local en el teléfono (anónimo, sin login) ---
const FEEDBACK_KEY = "cinefilo:tv-feedback";
const MYLIST_KEY = "cinefilo:tv-mylist";

type Feedback = { liked: string[]; disliked: string[] };
type SavedItem = {
  title: string;
  platform?: string;
  posterUrl?: string;
  year?: number;
  synopsis?: string;
  reason?: string;
};

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* noop */
  }
}
const readFeedback = (): Feedback => {
  const f = readJSON<Partial<Feedback>>(FEEDBACK_KEY, {});
  return { liked: f.liked ?? [], disliked: f.disliked ?? [] };
};
const readMyList = (): SavedItem[] => readJSON<SavedItem[]>(MYLIST_KEY, []);

function ControlPage() {
  const { session } = Route.useSearch();

  const [items, setItems] = useState<MediaItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<MediaItem | null>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [myList, setMyList] = useState<SavedItem[]>(() => readMyList());
  const [pendingSeen, setPendingSeen] = useState<MediaItem | null>(null);

  const loadReqLenRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewingListRef = useRef(false); // true mientras se muestra "Mi lista"

  const { status, paired, sendCommand } = useTvChannel({
    sessionId: session,
    role: "control",
    onState: (state) => {
      if (state.type === "SCREEN") {
        // Sincronizamos si estamos viendo "Mi lista" según lo que muestra la TV.
        viewingListRef.current = !!(state.items[0] && state.items[0].section === "Mi lista");
        setItems((prev) => {
          if (state.items.length > loadReqLenRef.current) setLoadingMore(false);
          return state.items;
        });
        if (state.items.length > 0) setSearching(false);
        setNowPlaying(null);
      } else if (state.type === "NOW_PLAYING") {
        setNowPlaying(state.media);
        setSearching(false);
      }
    },
  });

  const send = useCallback((cmd: ControlCommandMessage) => sendCommand(cmd), [sendCommand]);

  // --- Detección del ítem centrado al scrollear → FOCUS a la TV ---
  const cardEls = useRef<Map<string, HTMLElement>>(new Map());
  const centeredRef = useRef<string | null>(null);
  const registerCard = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) {
        el.dataset.id = id;
        cardEls.current.set(id, el);
      } else {
        cardEls.current.delete(id);
      }
    },
    [],
  );

  useEffect(() => {
    if (items.length === 0) return;
    centeredRef.current = null;
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.id;
          if (id) ratios.set(id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, r] of ratios) {
          if (r > bestRatio) {
            bestRatio = r;
            best = id;
          }
        }
        if (best && best !== centeredRef.current) {
          centeredRef.current = best;
          setCenteredId(best);
          send({ type: "FOCUS", mediaId: best });

          const idx = items.findIndex((i) => i.id === best);
          if (
            !viewingListRef.current &&
            idx >= 0 &&
            idx >= items.length - 3 &&
            loadReqLenRef.current !== items.length
          ) {
            loadReqLenRef.current = items.length;
            setLoadingMore(true);
            send({ type: "LOAD_MORE" });
            if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
            loadTimeoutRef.current = setTimeout(() => setLoadingMore(false), 15000);
          }
        }
      },
      { threshold: [0.25, 0.5, 0.75, 1] },
    );
    cardEls.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items, send]);

  const runSearch = useCallback(
    (q: string) => {
      const query = q.trim();
      if (!query) return;
      const fb = readFeedback();
      const seen = [...fb.liked, ...fb.disliked].slice(0, 40);
      viewingListRef.current = false;
      send({
        type: "SEARCH",
        query,
        exclude: seen,
        liked: fb.liked.slice(0, 20),
        disliked: fb.disliked.slice(0, 20),
      });
      setSearching(true);
      setText("");
    },
    [send],
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(text);
  };

  // --- "Ya la vi" + gustó/no gustó ---
  const rateSeen = (liked: boolean) => {
    const it = pendingSeen;
    if (!it) return;
    const fb = readFeedback();
    const arr = liked ? fb.liked : fb.disliked;
    if (!arr.includes(it.title)) arr.push(it.title);
    writeJSON(FEEDBACK_KEY, fb);
    send({ type: "REMOVE", mediaId: it.id });
    setPendingSeen(null);
    toast.success(liked ? "Anotado: te gustó 👍" : "Anotado: no te gustó 👎");
  };

  // --- "Mi lista" ---
  const inMyList = useCallback((title: string) => myList.some((m) => m.title === title), [myList]);

  const buildListItems = (list: SavedItem[]): MediaItem[] =>
    list.map((m, i) => ({
      id: "ml" + i,
      title: m.title,
      platform: m.platform,
      posterUrl: m.posterUrl,
      year: m.year,
      synopsis: m.synopsis,
      reason: m.reason,
      section: "Mi lista",
    }));

  // Muestra exactamente la lista dada en el teléfono + en la TV.
  const renderList = (list: SavedItem[]) => {
    const li = buildListItems(list);
    setItems(li);
    setCenteredId(li[0]?.id ?? null);
    send({ type: "SHOW_LIST", items: li });
  };

  const toggleMyList = (item: MediaItem) => {
    const exists = myList.some((m) => m.title === item.title);
    const next = exists
      ? myList.filter((m) => m.title !== item.title)
      : [
          ...myList,
          {
            title: item.title,
            platform: item.platform,
            posterUrl: item.posterUrl,
            year: item.year,
            synopsis: item.synopsis,
            reason: item.reason,
          },
        ];
    setMyList(next);
    writeJSON(MYLIST_KEY, next);
    toast(exists ? "Quitada de tu lista" : "Agregada a tu lista ✓");
    // Si estoy viendo "Mi lista", refrescar para que muestre solo las guardadas.
    if (viewingListRef.current) renderList(next);
  };

  const showMyList = () => {
    if (myList.length === 0) {
      toast("Tu lista está vacía. Tocá “Mi lista” en una película para guardarla.");
      return;
    }
    viewingListRef.current = true;
    renderList(myList);
  };

  if (!session) {
    return (
      <main
        className="flex min-h-screen items-center justify-center px-6 text-center"
        style={{ background: C.bg, color: C.text, fontFamily: SANS }}
      >
        <div className="max-w-xs">
          <Tv className="mx-auto h-10 w-10" style={{ color: C.muted }} />
          <h1 className="mt-4 text-xl font-semibold" style={{ fontFamily: SERIF }}>
            Sin sesión
          </h1>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            Abrí este control escaneando el código QR que aparece en la TV.
          </p>
        </div>
      </main>
    );
  }

  const centered = items.find((i) => i.id === centeredId) ?? null;

  return (
    <main
      className="mx-auto flex h-[100dvh] max-w-md flex-col"
      style={{ background: C.bg, color: C.text, fontFamily: SANS }}
    >
      {/* Barra superior fija */}
      <header
        className="shrink-0 px-4 pb-3 pt-4"
        style={{ borderBottom: `1px solid ${C.border}`, background: "#FBFAF5" }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xl font-semibold" style={{ fontFamily: SERIF }}>
            Cinéfilo<span style={{ color: C.accent }}> ✦</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={showMyList}
              className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium active:scale-95"
              style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.text }}
            >
              <Bookmark className="h-3.5 w-3.5" />
              Mi lista
              {myList.length > 0 && (
                <span
                  className="ml-0.5 rounded-full px-1.5 text-[10px] font-bold text-white"
                  style={{ background: C.accent }}
                >
                  {myList.length}
                </span>
              )}
            </button>
            <ConnBadge paired={paired} connecting={status === "connecting"} />
          </div>
        </div>
        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="¿Qué querés ver?"
            className="min-h-[48px] flex-1 rounded-2xl px-4 text-base focus:outline-none"
            style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.text }}
            enterKeyHint="search"
          />
          <VoiceRecordButton onResult={runSearch} disabled={!paired} />
          <button
            type="submit"
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl text-white active:scale-95 disabled:opacity-50"
            style={{ background: C.accent }}
            disabled={!paired || !text.trim()}
            aria-label="Buscar"
          >
            <Search className="h-5 w-5" />
          </button>
        </form>
      </header>

      {/* Lista scrolleable */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {searching ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3"
            style={{ color: C.muted }}
          >
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: C.accent }} />
            <span>Buscando…</span>
          </div>
        ) : items.length === 0 ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
            style={{ color: C.muted }}
          >
            <Search className="h-10 w-10" style={{ color: C.accent, opacity: 0.6 }} />
            <p>{paired ? "Buscá algo arriba y deslizá para elegir." : "Conectando con la TV…"}</p>
          </div>
        ) : (
          <ul className="space-y-2.5 pb-2">
            {items.map((item) => (
              <li key={item.id} ref={registerCard(item.id)}>
                <MovieCard
                  item={item}
                  centered={item.id === centeredId}
                  inList={inMyList(item.title)}
                  onSeen={() => setPendingSeen(item)}
                  onToggleList={() => toggleMyList(item)}
                />
              </li>
            ))}
            {loadingMore && (
              <li
                className="flex items-center justify-center gap-2 py-4"
                style={{ color: C.muted }}
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Cargando más…</span>
              </li>
            )}
            {/* Espacio extra para poder llevar la última película al centro y reproducirla. */}
            <li aria-hidden style={{ height: "40vh" }} />
          </ul>
        )}
      </div>

      {/* Barra inferior */}
      {items.length > 0 && (
        <div
          className="shrink-0 px-4 py-3"
          style={{ borderTop: `1px solid ${C.border}`, background: "#FBFAF5" }}
        >
          <div className="mb-2 truncate text-center text-sm" style={{ color: C.muted }}>
            {nowPlaying ? (
              <span style={{ color: C.text }}>▶ {nowPlaying.title}</span>
            ) : centered ? (
              <span className="font-medium" style={{ color: C.text }}>
                {centered.title}
              </span>
            ) : (
              "Deslizá para elegir"
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => send({ type: "BACK" })}
              disabled={!paired}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold active:scale-95 disabled:opacity-40"
              style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.text }}
            >
              <CornerDownLeft className="h-5 w-5" />
              Volver
            </button>
            <button
              type="button"
              onClick={() => centered && send({ type: "PLAY", mediaId: centered.id })}
              disabled={!paired || !centered}
              className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold text-white active:scale-95 disabled:opacity-40"
              style={{ background: C.accent }}
            >
              <Play className="h-5 w-5" />
              Reproducir
            </button>
          </div>
        </div>
      )}

      {/* Hoja "¿Te gustó?" */}
      {pendingSeen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setPendingSeen(null)}
        >
          <div
            className="w-full rounded-t-3xl p-5 pb-7"
            style={{ background: C.surface }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-xs uppercase tracking-wide" style={{ color: C.muted }}>
              Marcar como vista
            </p>
            <p
              className="mb-1 mt-1 text-center text-lg font-semibold"
              style={{ fontFamily: SERIF }}
            >
              {pendingSeen.title}
            </p>
            <p className="mb-4 text-center text-sm" style={{ color: C.muted }}>
              ¿Te gustó? Nos ayuda a recomendarte mejor.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => rateSeen(false)}
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold active:scale-95"
                style={{ border: `1px solid ${C.border}`, background: C.bg, color: C.text }}
              >
                <ThumbsDown className="h-5 w-5" />
                No me gustó
              </button>
              <button
                type="button"
                onClick={() => rateSeen(true)}
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold text-white active:scale-95"
                style={{ background: C.accent }}
              >
                <ThumbsUp className="h-5 w-5" />
                Me gustó
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPendingSeen(null)}
              className="mt-3 w-full py-2 text-sm"
              style={{ color: C.muted }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function MovieCard({
  item,
  centered,
  inList,
  onSeen,
  onToggleList,
}: {
  item: MediaItem;
  centered: boolean;
  inList: boolean;
  onSeen: () => void;
  onToggleList: () => void;
}) {
  return (
    <div
      className="relative rounded-2xl p-2.5"
      style={{
        border: `${centered ? 2 : 1}px solid ${centered ? C.accent : C.border}`,
        background: centered ? "rgba(204,120,92,0.06)" : C.surface,
        boxShadow: centered ? "0 4px 16px rgba(204,120,92,0.20)" : "none",
      }}
    >
      {/* Logo de plataforma en la esquina superior derecha */}
      {item.platform && (
        <span
          className="absolute right-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: colorForPlatform(item.platform) }}
        >
          {item.platform}
        </span>
      )}

      <div className="flex w-full items-start gap-3">
        <div
          className="h-[88px] w-[60px] shrink-0 overflow-hidden rounded-lg"
          style={{ background: C.posterBg }}
        >
          {item.posterUrl ? (
            <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center p-1 text-center text-[9px] font-medium leading-tight text-white"
              style={{
                background: `linear-gradient(135deg, ${colorForPlatform(item.platform ?? "")}, #3a3a33)`,
              }}
            >
              {item.title}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 pr-16">
            <p className="truncate text-sm font-semibold" style={{ color: C.text }}>
              {item.title}
            </p>
            {item.year && (
              <span className="shrink-0 text-[11px]" style={{ color: C.muted }}>
                {item.year}
              </span>
            )}
          </div>
          {item.synopsis && (
            <p className="mt-1 line-clamp-2 text-xs" style={{ color: C.muted }}>
              {item.synopsis}
            </p>
          )}
          {item.reason && (
            <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: C.text }}>
              <span className="font-semibold" style={{ color: C.accent }}>
                ✦ Por qué:{" "}
              </span>
              {item.reason}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onSeen}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium active:scale-95"
          style={{ border: `1px solid ${C.border}`, background: C.bg, color: C.text }}
        >
          <Eye className="h-3.5 w-3.5" />
          Ya la vi
        </button>
        <button
          type="button"
          onClick={onToggleList}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium active:scale-95"
          style={
            inList
              ? { background: "rgba(204,120,92,0.14)", color: C.accent }
              : { border: `1px solid ${C.border}`, background: C.bg, color: C.text }
          }
        >
          {inList ? (
            <BookmarkCheck className="h-3.5 w-3.5" />
          ) : (
            <Bookmark className="h-3.5 w-3.5" />
          )}
          {inList ? "En tu lista" : "Mi lista"}
        </button>
      </div>
    </div>
  );
}

function ConnBadge({ paired, connecting }: { paired: boolean; connecting: boolean }) {
  const label = connecting ? "Conectando…" : paired ? "TV conectada" : "Buscando TV…";
  const dot = connecting ? "#D9A23B" : paired ? "#3F9E6F" : "#BDB8AB";
  return (
    <span
      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
      style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.muted }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}
