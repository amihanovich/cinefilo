import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tv")({
  validateSearch: (search: Record<string, unknown>) => ({
    s: typeof search["s"] === "string" ? search["s"] : "",
  }),
  component: TVReceiver,
});

type TVMessage =
  | { type: "hello"; text: string }
  | { type: "recommendation"; title: string; platform: string; reason: string; poster?: string };

function TVReceiver() {
  const { s: sessionId } = Route.useSearch();
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<TVMessage | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const ch = supabase
      .channel(`cinefilo:session:${sessionId}`)
      .on("broadcast", { event: "message" }, ({ payload }: { payload: TVMessage }) => {
        setMessage(payload);
      })
      .on("broadcast", { event: "wizard_ping" }, () => {
        // Respond to phone ping so it knows the TV is ready
        void ch.send({ type: "broadcast", event: "tv_ready", payload: {} });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          await ch.send({ type: "broadcast", event: "tv_ready", payload: {} });
        }
      });

    channelRef.current = ch;
    return () => { void supabase.removeChannel(ch); };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-white/40">URL inválida — falta el parámetro <code>?s=</code></p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black text-white">
      {!message && (
        <>
          <div className="text-6xl">📺</div>
          <p className="text-3xl font-semibold tracking-tight">Cinéfilo</p>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-400" : "animate-pulse bg-white/30"}`} />
            <span className="text-white/40">{connected ? "Listo — esperando el teléfono" : "Conectando..."}</span>
          </div>
        </>
      )}

      {message?.type === "hello" && (
        <p className="px-12 text-center text-5xl font-bold">{message.text}</p>
      )}

      {message?.type === "recommendation" && (
        <div className="flex max-w-3xl flex-col items-center gap-6 px-12 text-center">
          {message.poster && (
            <img src={message.poster} alt={message.title} className="h-64 rounded-2xl object-cover shadow-2xl" />
          )}
          <p className="text-5xl font-bold leading-tight">{message.title}</p>
          <p className="text-xl text-white/60">{message.platform}</p>
          <p className="text-2xl leading-relaxed text-white/80">{message.reason}</p>
        </div>
      )}

      <p className="absolute bottom-6 text-xs text-white/20">sesión: {sessionId}</p>
    </div>
  );
}
