import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/tv")({
  component: TVReceiver,
});

const NAMESPACE = "urn:x-cast:com.cinefilo.app";

interface HelloMessage {
  type: "hello";
  text: string;
}

type CastMessage = HelloMessage;

function TVReceiver() {
  const [displayText, setDisplayText] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src =
      "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";
    script.async = true;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cast = (window as any).cast;
      const context = cast.framework.CastReceiverContext.getInstance();

      context.addCustomMessageListener(
        NAMESPACE,
        (event: { data: CastMessage }) => {
          if (event.data.type === "hello") {
            setDisplayText(event.data.text);
          }
        }
      );

      context.start();
      setReady(true);
    };

    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black text-white">
      {!ready && (
        <p className="text-white/40 text-xl">Iniciando Cinéfilo...</p>
      )}
      {ready && !displayText && (
        <>
          <div className="text-6xl">📺</div>
          <p className="text-3xl font-semibold tracking-tight">Cinéfilo</p>
          <p className="text-white/40">Esperando el teléfono...</p>
        </>
      )}
      {displayText && (
        <p className="px-12 text-center text-5xl font-bold">{displayText}</p>
      )}
    </div>
  );
}
