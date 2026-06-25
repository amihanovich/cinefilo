import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  ControlCommand,
  TvState,
  type ControlCommandMessage,
  type TvStateMessage,
} from "@/lib/tv-protocol";

/**
 * Une los dos clientes (TV y teléfono) a un mismo canal de Supabase Realtime
 * y traduce el broadcast crudo a mensajes tipados validados con Zod.
 *
 * - Teléfono → TV: evento "command"  (ControlCommand)
 * - TV → teléfono: evento "state"    (TvState)
 *
 * Usamos presence para saber cuándo el peer está conectado (vinculación QR),
 * sin tocar la base de datos: todo vive en el websocket, así el canal puede
 * ser anónimo mientras no haya login cableado.
 */

export type ChannelRole = "tv" | "control";
export type ChannelStatus = "connecting" | "connected" | "error";

const EVENT_COMMAND = "command";
const EVENT_STATE = "state";

/** Nombre del canal a partir del id de sesión. Único punto que lo define. */
export function channelName(sessionId: string): string {
  return `cinefilo:${sessionId}`;
}

interface UseTvChannelOptions {
  sessionId: string;
  role: ChannelRole;
  /** La TV escucha comandos del teléfono. */
  onCommand?: (cmd: ControlCommandMessage) => void;
  /** El teléfono escucha el estado de la TV. */
  onState?: (state: TvStateMessage) => void;
  /** Se dispara cuando entra/sale el peer (vinculación). */
  onPeerJoin?: () => void;
}

export interface TvChannel {
  status: ChannelStatus;
  /** true cuando el otro extremo (TV↔teléfono) está presente en el canal. */
  paired: boolean;
  /** Teléfono → TV. No-op (con warning) si lo llama la TV. */
  sendCommand: (cmd: ControlCommandMessage) => void;
  /** TV → teléfono. No-op (con warning) si lo llama el teléfono. */
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

  // Mantenemos los callbacks en refs para no re-suscribir el canal en cada
  // render cuando el consumidor pasa funciones inline.
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
      if (channelStatus === "SUBSCRIBED") {
        setStatus("connected");
        void channel.track({ role, online_at: new Date().toISOString() });
      } else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") {
        setStatus("error");
      }
    });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
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
