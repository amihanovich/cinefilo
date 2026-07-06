// Control remoto de la TV desde la app móvil. Port de src/routes/control.tsx
// (la página web de Carlos, que queda intacta como fallback), reestilizado al
// tema oscuro del móvil y usando el micrófono NATIVO existente (lib/stt.ts) en
// vez del botón de voz web. Se conecta al mismo canal Realtime (lado "control").

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search, Play, CornerDownLeft, Loader2, Eye, Bookmark, BookmarkCheck,
  ThumbsUp, ThumbsDown, Mic, X, Smartphone,
} from "lucide-react";
import { useTvChannel } from "../hooks/use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "../lib/tv-protocol";
import { colorForPlatform } from "../lib/deeplink";
import { VoiceRecorder, transcribe } from "../lib/stt";
import { ControlVoiceAgent } from "../components/ControlVoiceAgent";
import { Orb } from "../components/Orb";

const WATCHLIST_KEY = "cinefilo:watchlist";
const LIKED_KEY = "cinefilo:liked";
const DISLIKED_KEY = "cinefilo:disliked";

type SavedItem = { title: string; platform?: string; type?: string; posterUrl?: string; year?: number };

function readArr(key: string): SavedItem[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as SavedItem[];
  } catch {
    return [];
  }
}
function writeArr(key: string, v: SavedItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* noop */
  }
}
function addUnique(key: string, item: SavedItem): void {
  const arr = readArr(key);
  if (!arr.some((i) => i.title === item.title)) writeArr(key, [item, ...arr]);
}

function cn(...c: (string | boolean | undefined | null)[]): string {
  return c.filter(Boolean).join(" ");
}

interface ControlScreenProps {
  session: string;
  onClose: () => void;
}

export function ControlScreen({ session, onClose }: ControlScreenProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<MediaItem | null>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [myList, setMyList] = useState<SavedItem[]>(() => readArr(WATCHLIST_KEY));
  const [pendingSeen, setPendingSeen] = useState<MediaItem | null>(null);
  const [micState, setMicState] = useState<"idle" | "rec" | "processing">("idle");
  const [voiceOpen, setVoiceOpen] = useState(false);

  const loadReqLenRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewingListRef = useRef(false);
  const micRef = useRef<VoiceRecorder | null>(null);

  const { status, paired, sendCommand } = useTvChannel({
    sessionId: session,
    role: "control",
    onState: (state) => {
      if (state.type === "SCREEN") {
        viewingListRef.current = !!(state.items[0] && state.items[0].section === "Mi lista");
        setItems(() => {
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

  // Scroll → FOCUS + carga infinita (idéntico a control.tsx).
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
          if (!viewingListRef.current && idx >= 0 && idx >= items.length - 3 && loadReqLenRef.current !== items.length) {
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
      const liked = readArr(LIKED_KEY).map((i) => i.title);
      const disliked = readArr(DISLIKED_KEY).map((i) => i.title);
      viewingListRef.current = false;
      send({
        type: "SEARCH",
        query,
        exclude: [...liked, ...disliked].slice(0, 40),
        liked: liked.slice(0, 20),
        disliked: disliked.slice(0, 20),
      });
      setSearching(true);
      setText("");
    },
    [send],
  );

  // Micrófono nativo (mismo patrón que wizard.tsx).
  const toggleMic = async () => {
    if (micState === "rec") {
      const rec = micRef.current;
      micRef.current = null;
      setMicState("processing");
      if (!rec) {
        setMicState("idle");
        return;
      }
      const blob = await rec.stop();
      if (blob.size < 1) {
        setMicState("idle");
        return;
      }
      try {
        const t = await transcribe(blob);
        if (t.trim()) runSearch(t.trim());
      } catch {
        /* noop */
      }
      setMicState("idle");
    } else if (micState === "idle") {
      const rec = new VoiceRecorder();
      micRef.current = rec;
      try {
        await rec.start({
          silenceMs: 2500,
          onAutoStop: async () => {
            micRef.current = null;
            setMicState("processing");
            const blob = await rec.stop();
            if (blob.size >= 1) {
              try {
                const t = await transcribe(blob);
                if (t.trim()) runSearch(t.trim());
              } catch {
                /* noop */
              }
            }
            setMicState("idle");
          },
        });
        setMicState("rec");
      } catch {
        micRef.current = null;
        setMicState("idle");
      }
    }
  };

  const rateSeen = (liked: boolean) => {
    const it = pendingSeen;
    if (!it) return;
    addUnique(liked ? LIKED_KEY : DISLIKED_KEY, { title: it.title, platform: it.platform, type: "Película" });
    send({ type: "REMOVE", mediaId: it.id });
    setPendingSeen(null);
  };

  const inMyList = (title: string) => myList.some((m) => m.title === title);
  const toggleMyList = (item: MediaItem) => {
    const exists = myList.some((m) => m.title === item.title);
    const next = exists
      ? myList.filter((m) => m.title !== item.title)
      : [{ title: item.title, platform: item.platform, type: "Película", posterUrl: item.posterUrl, year: item.year }, ...myList];
    setMyList(next);
    writeArr(WATCHLIST_KEY, next);
    if (viewingListRef.current) showMyList(next);
  };

  const showMyList = (list = myList) => {
    if (list.length === 0) return;
    viewingListRef.current = true;
    const li: MediaItem[] = list.map((m, i) => ({
      id: "ml" + i,
      title: m.title,
      platform: m.platform,
      posterUrl: m.posterUrl,
      year: m.year,
      section: "Mi lista",
    }));
    setItems(li);
    setCenteredId(li[0]?.id ?? null);
    send({ type: "SHOW_LIST", items: li });
  };

  const centered = items.find((i) => i.id === centeredId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background safe-top safe-bottom">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground active:scale-95">
            <X className="h-4 w-4" /> Cerrar
          </button>
          <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" style={{ color: paired ? "#4ade80" : status === "connecting" ? "#d9a23b" : "#888" }} />
            {status === "connecting" ? "Conectando…" : paired ? "TV conectada" : "Buscando TV…"}
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(text);
          }}
          className="flex gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="¿Qué querés ver?"
            enterKeyHint="search"
            className="min-h-[48px] flex-1 rounded-2xl border border-border bg-muted/30 px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void toggleMic()}
            disabled={!paired}
            className={cn(
              "relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-border disabled:opacity-40",
              micState === "rec" ? "bg-primary text-white" : "bg-muted/30 text-foreground",
            )}
          >
            {micState === "processing" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
            {micState === "rec" && <span className="pointer-events-none absolute inset-0 rounded-2xl bg-primary/40 animate-ping" />}
          </button>
          <button
            type="submit"
            disabled={!paired || !text.trim()}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl bg-primary text-white active:scale-95 disabled:opacity-40"
            aria-label="Buscar"
          >
            <Search className="h-5 w-5" />
          </button>
        </form>
        <button
          onClick={() => showMyList()}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground active:scale-95"
        >
          <Bookmark className="h-3.5 w-3.5" /> Mi lista {myList.length > 0 && `(${myList.length})`}
        </button>
      </div>

      {/* Lista */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {searching ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span>Buscando…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            <Search className="h-10 w-10 text-primary/60" />
            <p>{paired ? "Buscá algo arriba y deslizá para elegir." : "Conectando con la TV…"}</p>
          </div>
        ) : (
          <>
            {/* Orbe: seguir iterando con Cinéfilo (más recomendaciones o preguntar
                sobre la película centrada). Queda FIJO arriba mientras se deslizan
                las tarjetas (sticky), así siempre está a mano. El wrapper cancela
                el padding lateral/superior del scroll (-mx-4 -mt-4) para que su
                fondo tape las tarjetas de punta a punta al quedar pegado. */}
            <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 bg-background/95 px-4 pb-2.5 pt-4 backdrop-blur">
              <button
                onClick={() => setVoiceOpen(true)}
                disabled={!paired}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/40 px-3 py-2.5 text-left active:scale-[0.99] disabled:opacity-40"
              >
                <Orb phase="idle" size="mini" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">Hablar con Cinéfilo</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {centered ? `Pedile más o preguntá sobre ${centered.title}` : "Pedile más recomendaciones"}
                  </span>
                </span>
              </button>
            </div>
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
              <li className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> <span>Cargando más…</span>
              </li>
            )}
            <li aria-hidden style={{ height: "40vh" }} />
            </ul>
          </>
        )}
      </div>

      {/* Barra inferior */}
      {items.length > 0 && (
        <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-3">
          <div className="mb-2 truncate text-center text-sm text-muted-foreground">
            {nowPlaying ? (
              <span className="text-foreground">▶ {nowPlaying.title}</span>
            ) : centered ? (
              <span className="font-medium text-foreground">{centered.title}</span>
            ) : (
              "Deslizá para elegir"
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => send({ type: "BACK" })}
              disabled={!paired}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-border px-5 text-base font-semibold text-foreground active:scale-95 disabled:opacity-40"
            >
              <CornerDownLeft className="h-5 w-5" /> Volver
            </button>
            <button
              onClick={() => centered && send({ type: "PLAY", mediaId: centered.id })}
              disabled={!paired || !centered}
              className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-white active:scale-95 disabled:opacity-40"
            >
              <Play className="h-5 w-5" /> Reproducir
            </button>
          </div>
        </div>
      )}

      {/* Hoja "¿Te gustó?" */}
      {pendingSeen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/50" onClick={() => setPendingSeen(null)}>
          <div className="w-full rounded-t-3xl bg-background p-5 pb-7" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">Marcar como vista</p>
            <p className="mb-1 mt-1 text-center text-lg font-semibold text-foreground">{pendingSeen.title}</p>
            <p className="mb-4 text-center text-sm text-muted-foreground">¿Te gustó? Nos ayuda a recomendarte mejor.</p>
            <div className="flex gap-3">
              <button
                onClick={() => rateSeen(false)}
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl border border-border text-base font-semibold text-foreground active:scale-95"
              >
                <ThumbsDown className="h-5 w-5" /> No me gustó
              </button>
              <button
                onClick={() => rateSeen(true)}
                className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-white active:scale-95"
              >
                <ThumbsUp className="h-5 w-5" /> Me gustó
              </button>
            </div>
            <button onClick={() => setPendingSeen(null)} className="mt-3 w-full py-2 text-sm text-muted-foreground">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Orbe de voz: iterar con Cinéfilo (buscar más / preguntar sobre la centrada) */}
      {voiceOpen && (
        <ControlVoiceAgent
          centeredTitle={centered?.title ?? null}
          centeredPlatform={centered?.platform ?? null}
          onSearch={runSearch}
          onDismiss={() => setVoiceOpen(false)}
        />
      )}
    </div>
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
  const color = colorForPlatform(item.platform ?? "");
  return (
    <div
      className={cn(
        "relative rounded-2xl border p-2.5",
        centered ? "border-primary bg-primary/5" : "border-border bg-muted/20",
      )}
    >
      {item.platform && (
        <span
          className="absolute right-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {item.platform}
        </span>
      )}
      <div className="flex w-full items-start gap-3">
        <div className="h-[88px] w-[60px] shrink-0 overflow-hidden rounded-lg bg-muted">
          {item.posterUrl ? (
            <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-1 text-center text-[9px] font-medium leading-tight text-white" style={{ background: `linear-gradient(135deg, ${color}, #222)` }}>
              {item.title}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 pr-16">
            <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
            {item.year && <span className="shrink-0 text-[11px] text-muted-foreground">{item.year}</span>}
          </div>
          {item.synopsis && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.synopsis}</p>}
          {/* El "por qué" no se muestra acá: en esta tarjeta chica queda ilegible.
              Va completo en el banner grande de la TV, que es donde tiene sentido. */}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onSeen}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-medium text-foreground active:scale-95"
        >
          <Eye className="h-3.5 w-3.5" /> Ya la vi
        </button>
        <button
          onClick={onToggleList}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium active:scale-95",
            inList ? "bg-primary/15 text-primary" : "border border-border text-foreground",
          )}
        >
          {inList ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {inList ? "En tu lista" : "Mi lista"}
        </button>
      </div>
    </div>
  );
}
