import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Recommendation } from "@/lib/recommendations";

export const Route = createFileRoute("/tv")({
  validateSearch: (search: Record<string, unknown>) => ({
    s: typeof search["s"] === "string" ? search["s"] : "",
  }),
  component: TVReceiver,
});

type TVPayload =
  | { type: "results"; items: Recommendation[]; posters: Record<string, string | null>; selectedIndex: number }
  | { type: "select"; index: number };

function TVReceiver() {
  const { s: sessionId } = Route.useSearch();
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<Recommendation[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const ch = supabase
      .channel(`cinefilo:session:${sessionId}`)
      .on("broadcast", { event: "message" }, ({ payload }: { payload: TVPayload }) => {
        if (payload.type === "results") {
          setItems(payload.items);
          setPosters(payload.posters);
          setSelectedIndex(payload.selectedIndex);
        } else if (payload.type === "select") {
          setSelectedIndex(payload.index);
        }
      })
      .on("broadcast", { event: "wizard_ping" }, () => {
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

  // Idle screen — waiting for recommendations
  if (items.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black text-white">
        <div className="text-6xl">📺</div>
        <p className="text-3xl font-semibold tracking-tight">Cinéfilo</p>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-400" : "animate-pulse bg-white/30"}`} />
          <span className="text-white/40">{connected ? "Listo — esperando el teléfono" : "Conectando..."}</span>
        </div>
        <p className="absolute bottom-6 text-xs text-white/20">sesión: {sessionId}</p>
      </div>
    );
  }

  const current = items[selectedIndex];
  const poster = current ? posters[current.title] : null;

  return (
    <div className="flex h-screen flex-col bg-black text-white overflow-hidden">
      {/* Hero — top 70% */}
      <div className="relative flex-1 overflow-hidden">
        {/* Background poster */}
        {poster ? (
          <img
            src={poster}
            alt={current.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-zinc-900" />
        )}
        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-transparent" />

        {/* Content */}
        <div className="absolute bottom-0 left-0 right-0 px-16 pb-10">
          {/* Platform badge */}
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/50">
            {current.platform} · {current.type === "movie" ? "Película" : "Serie"} · {current.duration}
          </p>
          <h1 className="text-6xl font-black leading-none tracking-tight drop-shadow-lg">
            {current.title}
          </h1>
          <p className="mt-4 max-w-2xl text-xl leading-relaxed text-white/75">
            {current.reason}
          </p>
        </div>

        {/* Item counter */}
        <div className="absolute top-8 right-8 flex items-center gap-1.5">
          {items.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all ${
                i === selectedIndex ? "h-2.5 w-7 bg-white" : "h-2 w-2 bg-white/30"
              }`}
            />
          ))}
        </div>

        {/* Cinéfilo logo */}
        <div className="absolute top-8 left-8 flex items-center gap-2 opacity-60">
          <span className="text-lg font-bold tracking-tight">✦ Cinéfilo</span>
        </div>
      </div>

      {/* Alternatives strip — bottom 30% */}
      <div className="h-[30vh] border-t border-white/10 bg-black/90 px-8 py-5">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-white/30">
          Más opciones
        </p>
        <div className="flex h-full gap-4 pb-4">
          {items.map((item, i) => {
            const p = posters[item.title];
            const isActive = i === selectedIndex;
            return (
              <div
                key={item.title}
                className={`relative flex shrink-0 flex-col overflow-hidden rounded-xl transition-all ${
                  isActive
                    ? "ring-2 ring-white scale-105 shadow-xl"
                    : "opacity-50"
                }`}
                style={{ width: "calc((100% - 4 * 1rem) / 5)" }}
              >
                {p ? (
                  <img src={p} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-white/20 text-xs text-center px-2">
                    {item.title}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 py-2">
                  <p className="truncate text-[11px] font-semibold leading-tight">{item.title}</p>
                  <p className="text-[10px] text-white/50">{item.platform}</p>
                </div>
                {isActive && (
                  <div className="absolute top-2 left-2 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-black">
                    ▶
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
