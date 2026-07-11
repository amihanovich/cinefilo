// Control remoto web de la TV. Se abre al escanear el QR de la App TV desde un
// navegador (SIN la app móvil). Misma lógica que el control móvil nuevo: preview
// de lo que se ve en la TV arriba + D-pad direccional que mueve las tarjetas
// (envía NAVIGATE/SELECT/BACK/PLAY por el mismo canal Realtime, lado "control").
// La voz acá es SOLO dictado de búsqueda; el agente conversacional Cinéfilo vive
// en la app móvil, por eso hay un CTA fijo para descargarla.

import { useCallback, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import {
  Search, Play, CornerDownLeft, Loader2, Mic, Smartphone, Sparkles, ArrowRight, Bookmark,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useTvChannel } from "./hooks/use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "./lib/tv-protocol";
import { colorForPlatform, platformLabel } from "./lib/deeplink";
import { VoiceRecorder, transcribe } from "./lib/stt";

// Link real a la app (Play Store / landing). Si falta, mostramos "Próximamente".
const MOBILE_APP_URL = import.meta.env.VITE_MOBILE_APP_URL as string | undefined;

const MYLIST_KEY = "cinefilo:web-mylist";
const LIKED_KEY = "cinefilo:web-liked";
const DISLIKED_KEY = "cinefilo:web-disliked";

type SavedItem = { title: string; platform?: string; posterUrl?: string; year?: number };

function readArr(key: string): SavedItem[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as SavedItem[];
  } catch {
    return [];
  }
}

function cn(...c: (string | boolean | undefined | null)[]): string {
  return c.filter(Boolean).join(" ");
}

interface ControlScreenProps {
  session: string;
}

export function ControlScreen({ session }: ControlScreenProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<MediaItem | null>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [micState, setMicState] = useState<"idle" | "rec" | "processing">("idle");
  const micRef = useRef<VoiceRecorder | null>(null);

  const { status, paired, sendCommand } = useTvChannel({
    sessionId: session,
    role: "control",
    onState: (state) => {
      if (state.type === "SCREEN") {
        setItems(state.items);
        // La TV es dueña del foco: reflejamos su cursor en el preview.
        if (state.focusedId) setCenteredId(state.focusedId);
        setNowPlaying(null);
      } else if (state.type === "NOW_PLAYING") {
        setNowPlaying(state.media);
      }
    },
  });

  const send = useCallback((cmd: ControlCommandMessage) => sendCommand(cmd), [sendCommand]);
  const centered = items.find((i) => i.id === centeredId) ?? null;
  const previewItem = nowPlaying ?? centered;

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
      setText("");
    },
    [send],
  );

  const showMyList = () => {
    const list = readArr(MYLIST_KEY);
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

  // Voz = dictado de búsqueda (el Cinéfilo conversacional vive en la app móvil).
  const toggleMic = async () => {
    if (micState === "rec") {
      const rec = micRef.current;
      micRef.current = null;
      setMicState("processing");
      if (!rec) { setMicState("idle"); return; }
      const blob = await rec.stop();
      if (blob.size < 1) { setMicState("idle"); return; }
      try {
        const t = await transcribe(blob);
        setMicState("idle");
        if (t.trim()) runSearch(t.trim());
      } catch { setMicState("idle"); }
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
                setMicState("idle");
                if (t.trim()) runSearch(t.trim());
                return;
              } catch { /* noop */ }
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
    <main className="mx-auto flex h-[100dvh] max-w-md flex-col bg-background text-foreground safe-top safe-bottom">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
        <span className="flex items-center gap-1.5 text-lg font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Cinéfilo
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          <Smartphone className="h-3.5 w-3.5" style={{ color: paired ? "#4ade80" : status === "connecting" ? "#d9a23b" : "#888" }} />
          {status === "connecting" ? "Conectando…" : paired ? "TV conectada" : "Buscando TV…"}
        </span>
      </header>

      {/* CTA fijo: descargá la app (el agente Cinéfilo vive ahí) */}
      <DownloadBar />

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
                {platformLabel(previewItem.platform)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Búsqueda: texto + dictado por voz */}
      <div className="shrink-0 px-4 pt-3">
        <form onSubmit={(e) => { e.preventDefault(); runSearch(text); }} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="¿Qué querés ver?"
            enterKeyHint="search"
            disabled={!paired}
            className="min-h-[48px] flex-1 rounded-2xl border border-border bg-muted/30 px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => void toggleMic()}
            disabled={!paired}
            aria-label="Dictar búsqueda"
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
            aria-label="Buscar"
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl bg-primary text-white active:scale-95 disabled:opacity-40"
          >
            <Search className="h-5 w-5" />
          </button>
        </form>
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
    </main>
  );
}

// CTA siempre visible para bajar la app móvil (donde vive el agente Cinéfilo).
function DownloadBar() {
  const content = (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">Descargá la app para hablar con Cinéfilo</p>
        <p className="truncate text-[11px] text-muted-foreground">Voz, recomendaciones a medida y más</p>
      </div>
      {MOBILE_APP_URL ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white">
          Descargar <ArrowRight className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
          Próximamente
        </span>
      )}
    </div>
  );
  return (
    <div className="shrink-0 border-b border-border bg-primary/5">
      {MOBILE_APP_URL ? (
        <a href={MOBILE_APP_URL} target="_blank" rel="noopener noreferrer" className="block active:scale-[0.99]">
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
}
