// Control remoto de la TV desde la app móvil. Se activa al escanear el QR de la
// App TV. Espejo de apps/web-control/src/ControlScreen.tsx (mantener en sync a
// mano): mic vivo integrado (tocás y hablás, sin pantalla intermedia) + búsqueda
// por texto + filtros que te acompañan + Mi lista / Ya vistas + D-pad y
// acciones, por el mismo canal Realtime (lado "control").

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import {
  Search, Play, CornerDownLeft, X, Smartphone, Plus, Check, Mic,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Home as HomeIcon, Bookmark, Eye, ThumbsUp, ThumbsDown, SlidersHorizontal,
} from "lucide-react";
import { useTvChannel } from "../hooks/use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "../lib/tv-protocol";
import { colorForPlatform, PLATFORM_COLORS } from "../lib/deeplink";
import { Orb, type OrbPhase } from "../components/Orb";
import { ControlSearchOverlay } from "../components/ControlSearchOverlay";
import { VoiceRecorder, transcribe } from "../lib/stt";

const LIKED_KEY = "miru:liked";
const DISLIKED_KEY = "miru:disliked";
// Filtros que te acompañan: la MISMA clave que usa el resto de la app móvil
// (wizard / AccountSheet), así el control y la app comparten las plataformas.
const PLATFORMS_KEY = "miru:platforms";
const RECENT_KEY = "miru:prefer-recent";

const PLATFORM_OPTIONS = Object.keys(PLATFORM_COLORS);

function platformLabel(platform: string): string {
  return platform === "Star+" ? "Disney+" : platform;
}

type SavedItem = { title: string; platform?: string; posterUrl?: string; year?: number };

function readArr(key: string): SavedItem[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as SavedItem[];
  } catch {
    return [];
  }
}

function pushArr(key: string, item: SavedItem): void {
  try {
    const arr = readArr(key);
    if (!arr.find((i) => i.title === item.title)) arr.unshift(item);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    /* noop */
  }
}

function readPlatforms(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
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
  const [todayTitles, setTodayTitles] = useState<string[]>([]);
  const [myList, setMyList] = useState<MediaItem[]>([]);
  const [tvScreen, setTvScreen] = useState<string>("home");
  const [pendingSeen, setPendingSeen] = useState<MediaItem | null>(null);

  // Filtros
  const [platforms, setPlatforms] = useState<string[]>(readPlatforms);
  const [preferRecent, setPreferRecent] = useState<boolean>(() => localStorage.getItem(RECENT_KEY) === "1");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  // Feedback de actividad: rueda de búsqueda / rueda de "Abriendo X…"
  const [searching, setSearching] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [opening, setOpening] = useState<MediaItem | null>(null);

  const { status, paired, sendCommand } = useTvChannel({
    sessionId: session,
    role: "control",
    onState: (state) => {
      if (state.type === "SCREEN") {
        setItems(state.items);
        // La TV es la dueña del foco: reflejamos su cursor en el preview.
        if (state.focusedId) setCenteredId(state.focusedId);
        setTodayTitles(state.todayTitles ?? []);
        if (state.myList) setMyList(state.myList);
        setTvScreen(state.screen);
        setNowPlaying(null);
        // Llegaron resultados: apagar la rueda de búsqueda.
        if (state.items.length > 0) setSearching(null);
      } else if (state.type === "NOW_PLAYING") {
        setNowPlaying(state.media);
      }
    },
  });

  const send = useCallback((cmd: ControlCommandMessage) => sendCommand(cmd), [sendCommand]);
  const centered = items.find((i) => i.id === centeredId) ?? null;
  const previewItem = nowPlaying ?? centered;
  const inToday = (item: MediaItem | null) => !!item && todayTitles.indexOf(item.title) >= 0;

  // Los filtros acompañan: se emiten al vincular Y en cada cambio (antes se
  // mandaban una sola vez por pairing y los cambios no llegaban a la TV).
  useEffect(() => {
    if (!paired) return;
    send({ type: "SET_PLATFORMS", platforms });
  }, [paired, platforms, send]);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => {
      const next = prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p];
      try {
        localStorage.setItem(PLATFORMS_KEY, JSON.stringify(next));
      } catch { /* noop */ }
      return next;
    });
  };
  const toggleRecent = () => {
    setPreferRecent((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RECENT_KEY, next ? "1" : "0");
      } catch { /* noop */ }
      return next;
    });
  };

  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const okPress = () => {
    const item = centered;
    if (!item) { send({ type: "SELECT", mediaId: centeredId ?? undefined }); return; }
    // En la ficha, OK activa el botón enfocado de la TV (default: "Ver en X" →
    // un tap más adentro = ir a la plataforma).
    if (tvScreen === "detail") { send({ type: "SELECT" }); return; }
    // Regla de tapping: 1 OK = ver la ficha; doble OK (<350ms) = guardar/sacar
    // de "Mi lista".
    if (okTimerRef.current) {
      clearTimeout(okTimerRef.current); okTimerRef.current = null;
      send({ type: "ADD_TODAY", mediaId: item.id }); return;
    }
    okTimerRef.current = setTimeout(() => { okTimerRef.current = null; send({ type: "OPEN_DETAIL", mediaId: item.id }); }, 350);
  };
  const toggleMyList = () => { if (centeredId) send({ type: "ADD_TODAY", mediaId: centeredId }); };

  // "Ya la vi": pregunta si gustó (alimenta liked/disliked del SEARCH) y saca la
  // tarjeta de la TV.
  const rateSeen = (liked: boolean) => {
    const it = pendingSeen;
    if (!it) return;
    pushArr(liked ? LIKED_KEY : DISLIKED_KEY, {
      title: it.title, platform: it.platform, posterUrl: it.posterUrl, year: it.year,
    });
    send({ type: "REMOVE", mediaId: it.id });
    setPendingSeen(null);
  };

  const runSearch = useCallback(
    (q: string) => {
      const query = q.trim();
      if (!query) return;
      const liked = readArr(LIKED_KEY).map((i) => i.title);
      const disliked = readArr(DISLIKED_KEY).map((i) => i.title);
      send({
        type: "SEARCH",
        query,
        exclude: [...liked, ...disliked].slice(0, 40),
        liked: liked.slice(0, 20),
        disliked: disliked.slice(0, 20),
        preferRecent: preferRecent || undefined,
      });
      setText("");
      // Rueda acá también (la TV muestra la suya): el control no queda mudo.
      setSearching(query);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => setSearching(null), 45000);
    },
    [send, preferRecent],
  );

  // "Ya vistas": las calificadas localmente (👍/👎), mostradas en la TV.
  const showSeen = () => {
    const seen = [...readArr(LIKED_KEY), ...readArr(DISLIKED_KEY)];
    if (seen.length === 0) return;
    const li: MediaItem[] = seen.map((m, i) => ({
      id: "sv" + i,
      title: m.title,
      platform: m.platform,
      posterUrl: m.posterUrl,
      year: m.year,
      section: "Ya vistas",
    }));
    send({ type: "SHOW_LIST", items: li });
  };
  const seenCount = readArr(LIKED_KEY).length + readArr(DISLIKED_KEY).length;

  // ── Mic vivo integrado (sin pantalla intermedia): tocás el orbe → grabás,
  // tocás de nuevo → transcribe y dispara la búsqueda con la rueda. ──────────
  type VoiceState = "idle" | "listening" | "thinking";
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [volume, setVolume] = useState(0);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);
  const orbPhase: OrbPhase = voiceState === "listening" ? "listening" : voiceState === "thinking" ? "thinking" : "idle";
  const startListening = async () => {
    setVoiceHint(null);
    setVoiceState("listening");
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start({ autoStop: false, onVolume: (v) => { if (mountedRef.current) setVolume(v); } });
    } catch {
      recorderRef.current = null;
      if (mountedRef.current) {
        setVoiceHint("No pude acceder al micrófono. Dale permiso a Miru y probá de nuevo.");
        setVoiceState("idle");
      }
    }
  };
  const stopListening = async () => {
    setVoiceState("thinking");
    setVolume(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    try {
      const blob = await recorder.stop();
      const q = blob.size >= 1000 ? (await transcribe(blob)).trim() : "";
      if (!mountedRef.current) return;
      setVoiceState("idle");
      if (!q) { setVoiceHint("No te escuché. Probá de nuevo."); return; }
      runSearch(q);
    } catch {
      if (mountedRef.current) {
        setVoiceHint("No te escuché. Probá de nuevo.");
        setVoiceState("idle");
      }
    }
  };
  const micTap = () => {
    if (!paired || voiceState === "thinking") return;
    if (voiceState === "listening") void stopListening();
    else void startListening();
  };

  // ── D-pad: mueve la selección entre las tarjetas de la TV ───────────────────
  // Modelo "arrastrás el contenido" (como el scroll del celular): la flecha /
  // el gesto mueven la LISTA, no el cursor → se envía la dirección opuesta.
  type Dir = "up" | "down" | "left" | "right";
  const INVERT: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
  const nav = (direction: Dir) => send({ type: "NAVIGATE", direction: INVERT[direction] });
  const padStart = useRef<{ x: number; y: number } | null>(null);
  const onPadTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    padStart.current = { x: t.clientX, y: t.clientY };
  };
  const onPadTouchEnd = (e: ReactTouchEvent) => {
    const s = padStart.current;
    padStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return; // fue un tap: lo maneja el botón
    if (Math.abs(dx) > Math.abs(dy)) nav(dx > 0 ? "right" : "left");
    else nav(dy > 0 ? "down" : "up");
  };

  const play = () => {
    if (!previewItem) return;
    send({ type: "PLAY", mediaId: previewItem.id });
    // Rueda "Abriendo X…" acá también (la TV muestra la suya).
    setOpening(previewItem);
    setTimeout(() => setOpening(null), 3000);
  };

  const padBtn =
    "flex aspect-square items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground transition-transform active:scale-90 active:bg-primary/20 disabled:opacity-40";
  const chipBtn =
    "flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border py-2.5 text-xs font-semibold text-foreground active:scale-95 disabled:opacity-40";

  const myListForSheet: MediaItem[] = myList.length
    ? myList
    : todayTitles.map((t, i) => ({ id: "tt" + i, title: t }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background safe-top safe-bottom">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground active:scale-95">
          <X className="h-4 w-4" /> Salir
        </button>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          <Smartphone className="h-3.5 w-3.5" style={{ color: paired ? "#4ade80" : status === "connecting" ? "#d9a23b" : "#888" }} />
          {status === "connecting" ? "Conectando…" : paired ? "TV conectada" : "Buscando TV…"}
        </span>
      </div>

      {/* Atajos que te acompañan: Filtros / Mi lista / Ya vistas */}
      <div className="flex shrink-0 gap-2 px-4 pt-3">
        <button
          onClick={() => setFiltersOpen(true)}
          disabled={!paired}
          className={chipBtn + (platforms.length > 0 || preferRecent ? " border-primary text-primary" : "")}
        >
          <SlidersHorizontal className="h-4 w-4" /> Filtros
          {platforms.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{platforms.length}</span>
          )}
        </button>
        <button
          onClick={() => setListOpen(true)}
          disabled={!paired || todayTitles.length === 0}
          className={chipBtn}
        >
          <Bookmark className="h-4 w-4" /> Mi lista
          {todayTitles.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{todayTitles.length}</span>
          )}
        </button>
        <button onClick={showSeen} disabled={!paired || seenCount === 0} className={chipBtn}>
          <Eye className="h-4 w-4" /> Ya vistas
        </button>
      </div>

      {/* Mic vivo: el orbe ES el micrófono, protagonista y directo */}
      <div className="flex shrink-0 flex-col items-center px-4 pt-4">
        {voiceState === "listening" && (
          <div className="mb-2 flex items-center gap-2 rounded-full bg-red-500/20 px-4 py-1 ring-1 ring-red-400/40">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-xs font-semibold tracking-wide text-red-200">Grabando</span>
          </div>
        )}
        <button
          onClick={micTap}
          disabled={!paired}
          aria-label={voiceState === "listening" ? "Frenar y buscar" : "Hablarle a Miru"}
          className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full shadow-[0_0_44px_rgba(136,82,224,0.30)] transition-transform active:scale-95 disabled:opacity-40"
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          <Orb phase={orbPhase} size="mini" sizePx={112} volume={volume} />
          {voiceState === "idle" && (
            <Mic className="absolute h-10 w-10 text-white drop-shadow-[0_1px_5px_rgba(0,0,0,0.65)]" />
          )}
        </button>
        <p className="mt-2 text-center text-sm font-semibold text-primary">
          {voiceHint ??
            (voiceState === "listening"
              ? "Te escucho · tocá para buscar"
              : voiceState === "thinking"
                ? "Procesando lo que dijiste…"
                : "Hablame y decime qué te gustaría ver")}
        </p>
      </div>

      {/* Búsqueda por texto, secundaria al mic (antes el control móvil no tenía
          fallback de texto si el STT fallaba) */}
      <div className="shrink-0 px-4 pt-3">
        <form onSubmit={(e) => { e.preventDefault(); runSearch(text); }} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="…o escribilo acá"
            enterKeyHint="search"
            disabled={!paired}
            className="min-h-[48px] flex-1 rounded-2xl border border-border bg-muted/30 px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!paired || !text.trim()}
            aria-label="Buscar"
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl bg-primary text-white active:scale-95 disabled:opacity-40"
          >
            <Search className="h-5 w-5" />
          </button>
        </form>
      </div>

      {/* Preview: SOLO cuando hay algo reproduciéndose (la TV se fue a la app de
          streaming y el teléfono queda como el único lugar que dice qué lanzaste). */}
      {nowPlaying && (
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/20 p-3">
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
              {nowPlaying.posterUrl ? (
                <img src={nowPlaying.posterUrl} alt={nowPlaying.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground/40">TV</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reproduciendo</p>
              <p className="truncate text-base font-bold text-foreground">{nowPlaying.title}</p>
              {nowPlaying.platform && (
                <span
                  className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: colorForPlatform(nowPlaying.platform) }}
                >
                  {platformLabel(nowPlaying.platform)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* D-pad direccional — justify-evenly reparte el alto sobrante (sin hueco muerto) */}
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-evenly gap-3 px-4 py-3"
        onTouchStart={onPadTouchStart}
        onTouchEnd={onPadTouchEnd}
      >
        <div className="grid grid-cols-3 grid-rows-3 gap-2" style={{ width: "min(60vw, 224px)" }}>
          <div />
          <button onClick={() => nav("up")} disabled={!paired} aria-label="Arriba" className={padBtn}>
            <ChevronUp className="h-6 w-6" />
          </button>
          <div />
          <button onClick={() => nav("left")} disabled={!paired} aria-label="Izquierda" className={padBtn}>
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={okPress}
            disabled={!paired}
            aria-label="OK"
            className="flex aspect-square items-center justify-center rounded-2xl bg-primary text-sm font-bold text-white transition-transform active:scale-90 disabled:opacity-40"
          >
            OK
          </button>
          <button onClick={() => nav("right")} disabled={!paired} aria-label="Derecha" className={padBtn}>
            <ChevronRight className="h-6 w-6" />
          </button>
          <div />
          <button onClick={() => nav("down")} disabled={!paired} aria-label="Abajo" className={padBtn}>
            <ChevronDown className="h-6 w-6" />
          </button>
          <div />
        </div>
        <p className="text-center text-[11px] text-muted-foreground/60">
          Movés la selección en la TV · deslizá o tocá las flechas
        </p>

        {/* Acciones */}
        <div className="flex w-full max-w-sm items-stretch gap-2">
          <button onClick={() => send({ type: "BACK" })} disabled={!paired} className={chipBtn}>
            <CornerDownLeft className="h-4 w-4" /> Volver
          </button>
          <button onClick={() => send({ type: "HOME" })} disabled={!paired} className={chipBtn}>
            <HomeIcon className="h-4 w-4" /> Inicio
          </button>
          <button
            onClick={play}
            disabled={!paired || !previewItem}
            className="flex flex-1 items-center justify-center gap-1 rounded-2xl bg-primary py-2.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-40"
          >
            <Play className="h-4 w-4" /> Play
          </button>
          <button
            onClick={toggleMyList}
            disabled={!paired || !centeredId}
            className={"flex flex-1 items-center justify-center gap-1 rounded-2xl border py-2.5 text-xs font-semibold active:scale-95 disabled:opacity-40 " + (inToday(centered) ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground")}
          >
            {inToday(centered) ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Mi lista
          </button>
          <button
            onClick={() => centered && setPendingSeen(centered)}
            disabled={!paired || !centered}
            className={chipBtn}
          >
            <Eye className="h-4 w-4" /> Ya la vi
          </button>
        </div>
      </div>

      {/* Rueda de búsqueda (overlay): también acá, no solo en la TV */}
      {searching !== null && <ControlSearchOverlay query={searching} platforms={platforms} />}

      {/* Rueda "Abriendo <plataforma>…" al dar Play */}
      {opening?.platform && (
        <ControlSearchOverlay query="" platforms={[]} fixedPlatform={opening.platform} headline={opening.title} />
      )}

      {/* Sheet de filtros: plataformas + "Priorizar los más recientes" */}
      {filtersOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={() => setFiltersOpen(false)}>
          <div
            className="w-full rounded-t-3xl border-t border-border bg-background p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-bold text-foreground">Filtros</p>
              <button onClick={() => setFiltersOpen(false)} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground active:scale-90">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Plataformas</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={"flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold active:scale-95 " + (on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: colorForPlatform(p) }} />
                    {p}
                    {on && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={toggleRecent}
              className="mb-4 flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3 active:scale-[0.99]"
            >
              <span className="text-sm font-semibold text-foreground">Priorizar los más recientes</span>
              <span className={"relative h-6 w-11 rounded-full transition-colors " + (preferRecent ? "bg-primary" : "bg-muted")}>
                <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " + (preferRecent ? "left-[22px]" : "left-0.5")} />
              </span>
            </button>
            <p className="mb-4 text-xs text-muted-foreground">
              Sin plataformas elegidas, buscamos en todas. Los filtros quedan activos para todas tus búsquedas.
            </p>
            <button
              onClick={() => setFiltersOpen(false)}
              className="min-h-[48px] w-full rounded-2xl bg-primary text-sm font-semibold text-white active:scale-[0.99]"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}

      {/* Sheet "Mi lista": los guardados de la TV, con carátulas (SCREEN.myList) */}
      {listOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={() => setListOpen(false)}>
          <div
            className="flex max-h-[75dvh] w-full flex-col rounded-t-3xl border-t border-border bg-background p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-bold text-foreground">Mi lista</p>
              <button onClick={() => setListOpen(false)} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground active:scale-90">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {myListForSheet.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { send({ type: "OPEN_DETAIL", mediaId: m.id }); setListOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/20 p-2.5 text-left active:scale-[0.99]"
                >
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {m.posterUrl && <img src={m.posterUrl} alt={m.title} className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {[m.platform ? platformLabel(m.platform) : null, m.year].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => { send({ type: "SHOW_TODAY" }); setListOpen(false); }}
              className="mt-3 min-h-[48px] w-full rounded-2xl bg-primary text-sm font-semibold text-white active:scale-[0.99]"
            >
              Ver en la TV
            </button>
          </div>
        </div>
      )}

      {/* Hoja "¿Te gustó?" — marca vista, alimenta el gusto y saca la tarjeta */}
      {pendingSeen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={() => setPendingSeen(null)}>
          <div
            className="w-full rounded-t-3xl border-t border-border bg-background p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">Marcar como vista</p>
            <p className="mb-1 mt-1 text-center text-lg font-bold text-foreground">{pendingSeen.title}</p>
            <p className="mb-4 text-center text-sm text-muted-foreground">¿Te gustó? Nos ayuda a recomendarte mejor.</p>
            <div className="flex gap-3">
              <button
                onClick={() => rateSeen(false)}
                className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold text-foreground active:scale-95"
              >
                <ThumbsDown className="h-5 w-5" /> No me gustó
              </button>
              <button
                onClick={() => rateSeen(true)}
                className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-white active:scale-95"
              >
                <ThumbsUp className="h-5 w-5" /> Me gustó
              </button>
            </div>
            <button
              onClick={() => setPendingSeen(null)}
              className="mt-3 w-full py-2 text-sm text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
