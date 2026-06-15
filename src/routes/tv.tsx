import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tv")({
  validateSearch: (search: Record<string, unknown>) => ({
    s: typeof search["s"] === "string" ? search["s"] : "",
  }),
  component: CastTestTV,
});

function CastTestTV() {
  const { s: sessionId } = Route.useSearch();
  const [message, setMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const ch = supabase
      .channel(`cinefilo:session:${sessionId}`)
      .on("broadcast", { event: "phone_message" }, (msg: { payload?: { text?: string } }) => {
        setMessage(msg.payload?.text ?? null);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          await ch.send({
            type: "broadcast",
            event: "tv_ready",
            payload: {},
          });
        }
      });

    channelRef.current = ch;
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-white/40">URL inválida — falta el parámetro de sesión.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black text-white">
      <div className="flex items-center gap-3">
        <span
          className={`h-3 w-3 rounded-full ${connected ? "bg-green-400" : "animate-pulse bg-white/30"}`}
        />
        <span className="text-lg text-white/50">
          {connected ? "TV conectada" : "Conectando..."}
        </span>
      </div>

      {message ? (
        <p className="text-center text-5xl font-bold">{message}</p>
      ) : (
        <p className="text-2xl text-white/30">Esperando mensaje del teléfono...</p>
      )}

      <p className="text-xs text-white/20">sesión: {sessionId.slice(0, 8)}…</p>
    </div>
  );
}
