import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cast-test")({
  component: CastTestPhone,
});

function CastTestPhone() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [tvConnected, setTvConnected] = useState(false);
  const [lastEcho, setLastEcho] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const tvUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tv?s=${sessionId}`
      : `/tv?s=${sessionId}`;

  useEffect(() => {
    const ch = supabase
      .channel(`cinefilo:session:${sessionId}`)
      .on("broadcast", { event: "tv_ready" }, () => {
        setTvConnected(true);
      })
      .on("broadcast", { event: "echo" }, (msg: { payload?: { text?: string } }) => {
        setLastEcho(msg.payload?.text ?? null);
      })
      .subscribe();

    channelRef.current = ch;
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [sessionId]);

  const sendHello = async () => {
    await channelRef.current?.send({
      type: "broadcast",
      event: "phone_message",
      payload: { text: "Hola desde el teléfono 📱" },
    });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black p-8 text-white">
      <h1 className="text-2xl font-bold">Test de Cast — Teléfono</h1>

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-white/60">Escaneá este QR en tu TV</p>
        <div className="rounded-2xl bg-white p-4">
          <QRCodeSVG value={tvUrl} size={200} />
        </div>
        <p className="max-w-[260px] break-all text-center text-xs text-white/40">{tvUrl}</p>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${tvConnected ? "bg-green-400" : "bg-white/20"}`}
        />
        <span className="text-sm text-white/70">
          {tvConnected ? "TV conectada" : "Esperando TV..."}
        </span>
      </div>

      <button
        onClick={sendHello}
        disabled={!tvConnected}
        className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-30"
      >
        Enviar mensaje a la TV
      </button>

      {lastEcho && (
        <p className="text-sm text-green-400">Echo recibido: {lastEcho}</p>
      )}
    </div>
  );
}
