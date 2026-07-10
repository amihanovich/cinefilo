// Control remoto de la TV desde la app móvil. Se activa al escanear el QR de la
// App TV. Layout (como el control de Carlos): arriba un preview de lo que se ve en
// la TV + "Cinéfilo AI" (voz start/stop); abajo un D-pad direccional que mueve la
// selección entre las tarjetas de la TV (envía NAVIGATE/SELECT/BACK/PLAY por el
// mismo canal Realtime, lado "control"). No reinventa el protocolo.

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import {
  Play, CornerDownLeft, X, Smartphone, Bookmark,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
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

interface ControlScreenProps {
  session: string;
  onClose: () => void;
}

export function ControlScreen({ session, onClose }: ControlScreenProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<MediaItem | null>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const { status, paired, sendCommand } = useTvChannel({
    sessionId: session,
    role: "control",
    onState: (state) => {
      if (state.type === "SCREEN") {
        setItems(state.items);
        // La TV es la dueña del foco: reflejamos su cursor en el preview.
        if (state.focusedId) setCenteredId(state.focusedId);
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

  // ── D-pad: mueve la selección entre las tarjetas de la TV ───────────────────
  const nav = (direction: "up" | "down" | "left" | "right") => send({ type: "NAVIGATE", direction });
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

      {/* D-pad direccional */}
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-4"
        onTouchStart={onPadTouchStart}
        onTouchEnd={onPadTouchEnd}
      >
        <div className="grid grid-cols-3 grid-rows-3 gap-2.5" style={{ width: "min(80vw, 300px)" }}>
          <div />
          <button onClick={() => nav("up")} disabled={!paired} aria-label="Arriba" className={padBtn}>
            <ChevronUp className="h-7 w-7" />
          </button>
          <div />
          <button onClick={() => nav("left")} disabled={!paired} aria-label="Izquierda" className={padBtn}>
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            onClick={() => send({ type: "SELECT", mediaId: centeredId ?? undefined })}
            disabled={!paired}
            aria-label="OK"
            className="flex aspect-square items-center justify-center rounded-2xl bg-primary text-sm font-bold text-white transition-transform active:scale-90 disabled:opacity-40"
          >
            OK
          </button>
          <button onClick={() => nav("right")} disabled={!paired} aria-label="Derecha" className={padBtn}>
            <ChevronRight className="h-7 w-7" />
          </button>
          <div />
          <button onClick={() => nav("down")} disabled={!paired} aria-label="Abajo" className={padBtn}>
            <ChevronDown className="h-7 w-7" />
          </button>
          <div />
        </div>
        <p className="text-center text-[11px] text-muted-foreground/60">
          Movés la selección en la TV · deslizá o tocá las flechas
        </p>

        {/* Acciones */}
        <div className="flex w-full max-w-xs items-stretch gap-2">
          <button
            onClick={() => send({ type: "BACK" })}
            disabled={!paired}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground active:scale-95 disabled:opacity-40"
          >
            <CornerDownLeft className="h-5 w-5" /> Volver
          </button>
          <button
            onClick={() => previewItem && send({ type: "PLAY", mediaId: previewItem.id })}
            disabled={!paired || !previewItem}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-40"
          >
            <Play className="h-5 w-5" /> Play
          </button>
          <button
            onClick={showMyList}
            disabled={!paired}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground active:scale-95 disabled:opacity-40"
          >
            <Bookmark className="h-5 w-5" /> Mi lista
          </button>
        </div>
      </div>

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
