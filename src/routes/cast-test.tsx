import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

const APP_ID = "58ED99B5";
const NAMESPACE = "urn:x-cast:com.cinefilo.app";

export const Route = createFileRoute("/cast-test")({
  component: CastTestPhone,
});

type CastState =
  | "loading"
  | "unavailable"
  | "no_devices"
  | "not_connected"
  | "connecting"
  | "connected";

function CastTestPhone() {
  const [castState, setCastState] = useState<CastState>("loading");
  const [logs, setLogs] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-8), `${ts} ${msg}`]);
    console.log("[cast-test]", msg);
  };

  useEffect(() => {
    log("useEffect: setting __onGCastApiAvailable");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
      log(`__onGCastApiAvailable: isAvailable=${isAvailable}`);
      if (!isAvailable) {
        setCastState("unavailable");
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cast = (window as any).cast;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chrome = (window as any).chrome;

      try {
        cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: APP_ID,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.CUSTOM_CONTROLLER_SCOPED,
        });
        log("setOptions OK");
      } catch (e) {
        log(`setOptions ERROR: ${e}`);
      }

      cast.framework.CastContext.getInstance().addEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event: any) => {
          log(`CAST_STATE_CHANGED: ${event.castState}`);
          const { CastState: CS } = cast.framework;
          if (event.castState === CS.NO_DEVICES_AVAILABLE) setCastState("no_devices");
          else if (event.castState === CS.NOT_CONNECTED) setCastState("not_connected");
          else if (event.castState === CS.CONNECTING) setCastState("connecting");
          else if (event.castState === CS.CONNECTED) setCastState("connected");
        }
      );

      cast.framework.CastContext.getInstance().addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event: any) => {
          log(`SESSION_STATE_CHANGED: ${event.sessionState}`);
          const { SessionState } = cast.framework;
          if (
            event.sessionState === SessionState.SESSION_STARTED ||
            event.sessionState === SessionState.SESSION_RESUMED
          ) {
            sessionRef.current =
              cast.framework.CastContext.getInstance().getCurrentSession();
            setCastState("connected");
          } else if (event.sessionState === SessionState.SESSION_ENDED) {
            sessionRef.current = null;
            setCastState("not_connected");
          }
        }
      );

      setCastState("not_connected");
    };

    const script = document.createElement("script");
    script.src =
      "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.async = true;
    script.onload = () => log("cast_sender.js loaded");
    script.onerror = () => log("cast_sender.js FAILED to load");
    document.head.appendChild(script);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__onGCastApiAvailable;
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  const handleConnect = () => {
    log("handleConnect: using chrome.cast.requestSession");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chrome = (window as any).chrome;
    if (!chrome?.cast) {
      log("ERROR: chrome.cast not available");
      return;
    }
    const sessionRequest = new chrome.cast.SessionRequest(APP_ID);
    chrome.cast.requestSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session: any) => {
        log(`requestSession SUCCESS: ${session.sessionId}`);
        sessionRef.current = session;
        setCastState("connected");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error: any) => {
        log(`requestSession ERROR: ${JSON.stringify(error)}`);
      },
      sessionRequest
    );
  };

  const handleSendMessage = () => {
    if (!sessionRef.current) { log("no session"); return; }
    log("sending message...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionRef.current.sendMessage(
      NAMESPACE,
      { type: "hello", text: "Hola desde el teléfono 📱" },
      () => log("message sent OK"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => log(`sendMessage ERROR: ${JSON.stringify(e)}`)
    );
  };

  const stateLabel: Record<CastState, string> = {
    loading: "Cargando SDK...",
    unavailable: "Cast no disponible — usá Chrome",
    no_devices: "No hay dispositivos Cast en la red",
    not_connected: "Listo para conectar",
    connecting: "Conectando...",
    connected: "TV conectada ✓",
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black p-8 text-white">
      <h1 className="text-2xl font-bold">Test de Cast — Teléfono</h1>

      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            castState === "connected"
              ? "bg-green-400"
              : castState === "connecting"
                ? "animate-pulse bg-yellow-400"
                : "bg-white/20"
          }`}
        />
        <span className="text-sm text-white/70">{stateLabel[castState]}</span>
      </div>

      {(castState === "not_connected" || castState === "no_devices") && (
        <button
          onClick={handleConnect}
          disabled={castState === "no_devices"}
          className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-30"
        >
          Conectar TV
        </button>
      )}

      {castState === "connected" && (
        <button
          onClick={handleSendMessage}
          className="rounded-full bg-white px-8 py-3 text-sm font-semibold text-black"
        >
          Enviar "Hola desde el teléfono"
        </button>
      )}

      {/* Debug log — visible en pantalla */}
      {logs.length > 0 && (
        <div className="mt-4 w-full max-w-lg rounded-xl bg-white/5 p-4 font-mono text-[11px] text-white/50">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
