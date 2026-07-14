// Control remoto de la TV desde la app móvil. Se activa al escanear el QR de la
// App TV. Layout (como el control de Carlos): arriba un preview de lo que se ve en
// la TV + "Cinéfilo AI" (voz start/stop); abajo un D-pad direccional que mueve la
// selección entre las tarjetas de la TV (envía NAVIGATE/SELECT/BACK/PLAY por el
// mismo canal Realtime, lado "control"). No reinventa el protocolo.

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import {
  Play, CornerDownLeft, X, Smartphone, Bookmark, Plus, Check,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Home as HomeIcon, Clapperboard, Eye, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { useTvChannel } from "../hooks/use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "../lib/tv-protocol";
import { colorForPlatform } from "../lib/deeplink";
import { ControlVoiceAgent } from "../components/ControlVoiceAgent";
import { Orb } from "../components/Orb";

const WATCHLIST_KEY = "cinefilo:watchlist";
const LIKED_KEY = "cinefilo:liked";
const DISLIKED_KEY = "cinefilo:disliked";
// Plataformas que el usuario ya eligió en la app móvil (wizard / AccountSheet).
const PLATFORMS_KEY = "queveo:guest:default_platforms";

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

interface ControlScreenProps {
  session: string;
  onClose: () => void;
}

export function ControlScreen({ session, onClose }: ControlScreenProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<MediaItem | null>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pendingSeen, setPendingSeen] = useState<MediaItem | null>(null);
  const [todayTitles, setTodayTitles] = useState<string[]>([]);
  const [tvScreen, setTvScreen] = useState<string>("home");

  const { status, paired, sendCommand } = useTvChannel({
    sessionId: session,
    role: "control",
    onState: (state) => {
      if (state.type === "SCREEN") {
        setItems(state.items);
        // La TV es la dueña del foco: reflejamos su cursor en el preview.
        if (state.focusedId) setCenteredId(state.focusedId);
        setTodayTitles(state.todayTitles ?? []);
        setTvScreen(state.screen);
        setNowPlaying(null);
      } else if (state.type === "NOW_PLAYING") {
        setNowPlaying(state.media);
      }
    },
  });

  const send = useCallback((cmd: ControlCommandMessage) => sendCommand(cmd), [sendCommand]);

  // Al emparejar, heredar a la TV las plataformas ya elegidas en el móvil. Una vez.
  const platformsSentRef = useRef(false);
  useEffect(() => {
    if (!paired || platformsSentRef.current) return;
    let platforms: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(PLATFORMS_KEY) ?? "[]");
      if (Array.isArray(raw)) platforms = raw.filter((p): p is string => typeof p === "string");
    } catch {
      platforms = [];
    }
    if (platforms.length > 0) send({ type: "SET_PLATFORMS", platforms });
    platformsSentRef.current = true;
  }, [paired, send]);

  const centered = items.find((i) => i.id === centeredId) ?? null;
  const previewItem = nowPlaying ?? centered;

  // Voz → búsqueda en la TV (reusa el agente conversacional existente).
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
      });
    },
    [send],
  );

  // "Mi lista" → mostrarla en la TV.
  const showMyList = () => {
    const list = readArr(WATCHLIST_KEY);
    if (list.length === 0) return;
    const li: MediaItem[] = list.map((m, i) => ({
      id: "ml" + i,
      title: m.title,
      platform: m.platform,
      posterUrl: m.posterUrl,
      year: m.year,
      section: "Mi lista",
    }));
    send({ type: "SHOW_LIST", items: li });
  };

  const inToday = (item: MediaItem | null) => !!item && todayTitles.indexOf(item.title) >= 0;

  // OK contextual (espeja el móvil): en la ficha OK = ver ahora; en el carrito 1 OK =
  // ficha; fuera del carrito 1 OK = "Para hoy", doble OK (<350ms) = ficha.
  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const okPress = () => {
    const item = centered;
    if (!item) { send({ type: "SELECT", mediaId: centeredId ?? undefined }); return; }
    if (tvScreen === "detail") { send({ type: "PLAY", mediaId: item.id }); return; }
    if (inToday(item)) { send({ type: "OPEN_DETAIL", mediaId: item.id }); return; }
    if (okTimerRef.current) {
      clearTimeout(okTimerRef.current); okTimerRef.current = null;
      send({ type: "OPEN_DETAIL", mediaId: item.id }); return;
    }
    okTimerRef.current = setTimeout(() => {
      okTimerRef.current = null;
      send({ type: "ADD_TODAY", mediaId: item.id });
    }, 350);
  };

  // Atajo "Para hoy" (reemplaza "Mi lista"): agrega/saca el ítem centrado del carrito de la TV.
  const addToday = () => { if (centeredId) send({ type: "ADD_TODAY", mediaId: centeredId }); };

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

  const padBtn =
    "flex aspect-square items-center justify-center rounded-2xl border border-border bg-muted/40 text-foreground transition-transform active:scale-90 active:bg-primary/20 disabled:opacity-40";

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

      {/* Preview: lo que se ve en la TV (metadata; no stream de video) */}
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/20 p-3">
          <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
            {previewItem?.posterUrl ? (
              <img src={previewItem.posterUrl} alt={previewItem.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground/40">TV</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{nowPlaying ? "Reproduciendo" : "En la TV"}</p>
            <p className="truncate text-base font-bold text-foreground">
              {previewItem?.title ?? (paired ? "Movete con el pad para elegir" : "Conectando con la TV…")}
            </p>
            {previewItem?.platform && (
              <span
                className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ backgroundColor: colorForPlatform(previewItem.platform) }}
              >
                {previewItem.platform}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cinéfilo AI: hablarle por voz */}
      <div className="shrink-0 px-4 pt-3">
        <button
          onClick={() => setVoiceOpen(true)}
          disabled={!paired}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-primary/30 bg-primary/5 py-3 transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <Orb phase="idle" size="mini" />
          </span>
          <span className="text-sm font-semibold text-primary">Hablarle a Cinéfilo</span>
        </button>
      </div>

      {/* Atajos de vista: volver al inicio de la TV / ver el carrito con cartel */}
      <div className="flex shrink-0 gap-2 px-4 pt-3">
        <button
          onClick={() => send({ type: "HOME" })}
          disabled={!paired}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border py-2.5 text-xs font-semibold text-foreground active:scale-95 disabled:opacity-40"
        >
          <HomeIcon className="h-4 w-4" /> Inicio
        </button>
        <button
          onClick={() => send({ type: "SHOW_TODAY" })}
          disabled={!paired || todayTitles.length === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border py-2.5 text-xs font-semibold text-foreground active:scale-95 disabled:opacity-40"
        >
          <Clapperboard className="h-4 w-4" /> Candidatas
          {todayTitles.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
              {todayTitles.length}
            </span>
          )}
        </button>
      </div>

      {/* D-pad direccional */}
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-4"
        onTouchStart={onPadTouchStart}
        onTouchEnd={onPadTouchEnd}
      >
        <div className="grid grid-cols-3 grid-rows-3 gap-2" style={{ width: "min(62vw, 230px)" }}>
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
          <button
            onClick={() => send({ type: "BACK" })}
            disabled={!paired}
            className="flex flex-1 items-center justify-center gap-1 rounded-2xl border border-border py-2.5 text-xs font-semibold text-foreground active:scale-95 disabled:opacity-40"
          >
            <CornerDownLeft className="h-4 w-4" /> Volver
          </button>
          <button
            onClick={() => previewItem && send({ type: "PLAY", mediaId: previewItem.id })}
            disabled={!paired || !previewItem}
            className="flex flex-1 items-center justify-center gap-1 rounded-2xl bg-primary py-2.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-40"
          >
            <Play className="h-4 w-4" /> Play
          </button>
          <button
            onClick={addToday}
            disabled={!paired || !centeredId}
            className={"flex flex-1 items-center justify-center gap-1 rounded-2xl border py-2.5 text-xs font-semibold active:scale-95 disabled:opacity-40 " + (inToday(centered) ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground")}
          >
            {inToday(centered) ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Para hoy
          </button>
          <button
            onClick={() => centered && setPendingSeen(centered)}
            disabled={!paired || !centered}
            className="flex flex-1 items-center justify-center gap-1 rounded-2xl border border-border py-2.5 text-xs font-semibold text-foreground active:scale-95 disabled:opacity-40"
          >
            <Eye className="h-4 w-4" /> Ya la vi
          </button>
        </div>
      </div>

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

      {/* Cinéfilo AI (voz): buscar / preguntar por lo que está enfocado en la TV */}
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
