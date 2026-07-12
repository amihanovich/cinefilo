// Adaptado de apps/tv/src/hooks/use-tv-channel.ts. La lógica del canal —nombre
// `cinefilo:${id}`, eventos "command"/"state", presence keys "tv"/"control"— es
// byte-idéntica, porque tiene que emparejar con la app de TV y el /control ya
// desplegados. Único cambio: imports locales.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  ControlCommand,
  TvState,
  type ControlCommandMessage,
  type TvStateMessage,
} from "../lib/tv-protocol";

export type ChannelRole = "tv" | "control";
export type ChannelStatus = "connecting" | "connected" | "error";

const EVENT_COMMAND = "command";
const EVENT_STATE = "state";

export function channelName(sessionId: string): string {
  return `cinefilo:${sessionId}`;
}

interface UseTvChannelOptions {
  sessionId: string;
  role: ChannelRole;
  onCommand?: (cmd: ControlCommandMessage) => void;
  onState?: (state: TvStateMessage) => void;
  onPeerJoin?: () => void;
}

export interface TvChannel {
  status: ChannelStatus;
  paired: boolean;
  sendCommand: (cmd: ControlCommandMessage) => void;
  sendState: (state: TvStateMessage) => void;
}

export function useTvChannel({
  sessionId,
  role,
  onCommand,
  onState,
  onPeerJoin,
}: UseTvChannelOptions): TvChannel {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const [paired, setPaired] = useState(false);

  const onCommandRef = useRef(onCommand);
  const onStateRef = useRef(onState);
  const onPeerJoinRef = useRef(onPeerJoin);
  useEffect(() => {
    onCommandRef.current = onCommand;
    onStateRef.current = onState;
    onPeerJoinRef.current = onPeerJoin;
  });

  useEffect(() => {
    if (!sessionId) return;

    const peerRole: ChannelRole = role === "tv" ? "control" : "tv";
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 2000;

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      const channel = supabase.channel(channelName(sessionId), {
        config: {
          broadcast: { self: false },
          presence: { key: role },
        },
      });
      channelRef.current = channel;

      channel.on("broadcast", { event: EVENT_COMMAND }, ({ payload }) => {
        if (role !== "tv") return; // solo la TV consume comandos
        const parsed = ControlCommand.safeParse(payload);
        if (!parsed.success) {
          console.warn("[tv-channel] comando inválido descartado:", parsed.error.issues);
          return;
        }
        onCommandRef.current?.(parsed.data);
      });

      channel.on("broadcast", { event: EVENT_STATE }, ({ payload }) => {
        if (role !== "control") return; // solo el teléfono consume estado
        const parsed = TvState.safeParse(payload);
        if (!parsed.success) {
          console.warn("[tv-channel] estado inválido descartado:", parsed.error.issues);
          return;
        }
        onStateRef.current?.(parsed.data);
      });

      const syncPaired = () => {
        const state = channel.presenceState();
        const peerPresent = Object.prototype.hasOwnProperty.call(state, peerRole);
        setPaired((prev) => {
          if (peerPresent && !prev) onPeerJoinRef.current?.();
          return peerPresent;
        });
      };
      channel.on("presence", { event: "sync" }, syncPaired);
      channel.on("presence", { event: "join" }, syncPaired);
      channel.on("presence", { event: "leave" }, syncPaired);

      channel.subscribe((channelStatus) => {
        // Callbacks de un canal ya reemplazado o de un hook desmontado: ignorar.
        if (disposed || channelRef.current !== channel) return;
        if (channelStatus === "SUBSCRIBED") {
          reconnectDelay = 2000;
          setStatus("connected");
          void channel.track({ role, online_at: new Date().toISOString() });
        } else if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT" ||
          channelStatus === "CLOSED"
        ) {
          // Reconexión con backoff (2s→30s): antes el primer error dejaba el
          // control "muerto" (status error fijo) hasta salir y volver a entrar.
          setStatus("error");
          setPaired(false);
          if (reconnectTimer) return;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            channelRef.current = null;
            void supabase.removeChannel(channel);
            connect();
          }, reconnectDelay);
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) void supabase.removeChannel(ch);
    };
  }, [sessionId, role]);

  const sendCommand = useCallback(
    (cmd: ControlCommandMessage) => {
      if (role !== "control") {
        console.warn("[tv-channel] sendCommand solo está disponible para el control.");
        return;
      }
      void channelRef.current?.send({
        type: "broadcast",
        event: EVENT_COMMAND,
        payload: cmd,
      });
    },
    [role],
  );

  const sendState = useCallback(
    (state: TvStateMessage) => {
      if (role !== "tv") {
        console.warn("[tv-channel] sendState solo está disponible para la TV.");
        return;
      }
      void channelRef.current?.send({
        type: "broadcast",
        event: EVENT_STATE,
        payload: state,
      });
    },
    [role],
  );

  return { status, paired, sendCommand, sendState };
}
