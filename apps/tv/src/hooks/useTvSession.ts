// Lado TV del protocolo de Carlos. Genera la sesión, arma la URL del QR, y
// traduce los ControlCommand del teléfono a acciones de la app (handlers).
// Expone emisores de estado (SCREEN / NOW_PLAYING / PAIRED) para que App
// mantenga al teléfono en sync.

import { useCallback, useMemo, useRef } from "react";
import { useTvChannel } from "./use-tv-channel";
import type { ControlCommandMessage, MediaItem } from "../lib/tv-protocol";

// Dominio propio de la web-control (apps/web-control, servicio Railway aparte).
// El QR abre <CONTROL_BASE>/control?session=<id>. Se puede overridear con
// VITE_CONTROL_BASE_URL en el build. NOTA: NO es el backend de la API
// (cinefilo-production) — es la página del control remoto.
const CONTROL_BASE =
  (import.meta.env.VITE_CONTROL_BASE_URL as string | undefined) ??
  "https://cinefilo-copy-production.up.railway.app";

// sessionId de 6 bytes en hex, igual que public/tv-lite.html.
function makeSessionId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Acciones que la app expone al control remoto (teléfono).
export interface TvSessionHandlers {
  onSearch: (query: string, exclude: string[], liked: string[], disliked: string[]) => void;
  onNavigate: (direction: "up" | "down" | "left" | "right") => void;
  onSelect: (mediaId?: string) => void;
  onPlay: (mediaId: string) => void;
  onBack: () => void;
  onLoadMore: () => void;
  onRemove: (mediaId: string) => void;
  onShowList: (items: MediaItem[]) => void;
  onFocus: (mediaId: string) => void;
  onSetPlatforms: (platforms: string[]) => void;
}

export interface TvSession {
  sessionId: string;
  qrUrl: string;
  paired: boolean;
  connecting: boolean;
  emitScreen: (items: MediaItem[], focusedId: string | null) => void;
  emitNowPlaying: (media: MediaItem) => void;
}

export function useTvSession(handlers: TvSessionHandlers): TvSession {
  // Una sola sesión por vida del componente (estable entre renders).
  const sessionRef = useRef<string | null>(null);
  if (!sessionRef.current) sessionRef.current = makeSessionId();
  const sessionId = sessionRef.current;

  // handlers siempre frescos vía ref → no re-suscribimos el canal por cambiar
  // una función inline en cada render de App.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onCommand = useCallback((cmd: ControlCommandMessage) => {
    const h = handlersRef.current;
    switch (cmd.type) {
      case "SEARCH":
        h.onSearch(cmd.query, cmd.exclude ?? [], cmd.liked ?? [], cmd.disliked ?? []);
        break;
      case "NAVIGATE":
        h.onNavigate(cmd.direction);
        break;
      case "SELECT":
        h.onSelect(cmd.mediaId);
        break;
      case "PLAY":
        h.onPlay(cmd.mediaId);
        break;
      case "BACK":
        h.onBack();
        break;
      case "LOAD_MORE":
        h.onLoadMore();
        break;
      case "REMOVE":
        h.onRemove(cmd.mediaId);
        break;
      case "SET_PLATFORMS":
        h.onSetPlatforms(cmd.platforms);
        break;
      case "SHOW_LIST":
        h.onShowList(cmd.items);
        break;
      case "FOCUS":
        h.onFocus(cmd.mediaId);
        break;
    }
  }, []);

  const { status, paired, sendState } = useTvChannel({
    sessionId,
    role: "tv",
    onCommand,
    // Al conectarse el teléfono, avisamos PAIRED. El re-envío del SCREEN actual
    // (para que un teléfono recién conectado vea lo que hay en pantalla) lo hace
    // App observando `paired`, porque solo App conoce los items actuales.
    onPeerJoin: () => sendState({ type: "PAIRED" }),
  });

  const emitScreen = useCallback(
    (items: MediaItem[], focusedId: string | null) => {
      sendState({ type: "SCREEN", screen: "home", focusedId, items });
    },
    [sendState],
  );

  const emitNowPlaying = useCallback(
    (media: MediaItem) => {
      sendState({ type: "NOW_PLAYING", media });
    },
    [sendState],
  );

  const qrUrl = useMemo(
    () => `${CONTROL_BASE}/control?session=${sessionId}`,
    [sessionId],
  );

  return {
    sessionId,
    qrUrl,
    paired,
    connecting: status === "connecting",
    emitScreen,
    emitNowPlaying,
  };
}
