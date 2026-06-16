import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cast-test")({
  component: CastTestPhone,
});

const DEFAULT_SESSION = "cinefilo-test";

function CastTestPhone() {
  const [sessionId] = useState(DEFAULT_SESSION);
  const [connected, setConnected] = useState(false);
  const [sent, setSent] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const tvUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tv?s=${sessionId}`
      : `/tv?s=${sessionId}`;

  useEffect(() => {
    const ch = supabase
      .channel(`cinefilo:session:${sessionId}`)
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    channelRef.current = ch;
    return () => { void supabase.removeChannel(ch); };
  }, [sessionId]);

  const sendHello = async () => {
    if (!channelRef.current) return;
    await channelRef.current.send({
      type: "broadcast",
      event: "message",
      payload: { type: "hello", text: "Hola desde el teléfono 📱" },
    });
    setSent(true);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-8 text-white">
      <h1 className="text-2xl font-bold">Test de Cast — Teléfono</h1>

      {/* Step 1: TV URL */}
      <div className="flex w-full max-w-sm flex-col gap-2 rounded-2xl bg-white/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Paso 1 — Abrí esto en la laptop conectada al TV
        </p>
        <p className="break-all font-mono text-sm text-white/90">{tvUrl}</p>
      </div>

      {/* Step 2: Connection status */}
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-400" : "animate-pulse bg-white/30"}`} />
        <span className="text-sm text-white/70">
          {connected ? "Teléfono listo" : "Conectando a Supabase..."}
        </span>
      </div>

      {/* Step 3: Send message */}
      <button
        onClick={sendHello}
        disabled={!connected}
        className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-30"
      >
        {sent ? "Mensaje enviado ✓" : "Enviar mensaje a la TV"}
      </button>

      <p className="text-xs text-white/20">sesión: {sessionId}</p>
    </div>
  );
}
