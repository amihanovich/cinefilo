// Pantalla de emparejamiento: QR (renderizado local, sin depender de un
// servicio externo de imágenes) para que el teléfono abra /control?session=<id>
// y funcione como control remoto. También se puede continuar con el control
// remoto físico de la TV (botón "Empezar").

import { useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import QRCode from "qrcode";

interface PairingScreenProps {
  qrUrl: string;
  paired: boolean;
  connecting: boolean;
  onContinue: () => void;
}

export function PairingScreen({ qrUrl, paired, connecting, onContinue }: PairingScreenProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(qrUrl, { width: 320, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => {
        if (alive) setQrDataUrl(url);
      })
      .catch(() => {
        /* si falla, la pantalla igual permite continuar con el control remoto */
      });
    return () => {
      alive = false;
    };
  }, [qrUrl]);

  return (
    <div className="tv-safe flex h-screen w-screen flex-col items-center justify-center gap-8 bg-background text-center">
      <div className="flex flex-col items-center gap-3">
        <Sparkles className="h-14 w-14 text-primary" />
        <h1 className="text-6xl font-bold tracking-tight text-foreground">Cinéfilo TV</h1>
        <p className="text-2xl text-muted-foreground">Tu guía para elegir qué ver esta noche</p>
      </div>

      <div className="flex items-center gap-10 rounded-3xl border-2 border-border bg-muted/30 px-12 py-8">
        <div className="flex h-52 w-52 items-center justify-center rounded-2xl bg-white p-3">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR para vincular el teléfono" className="h-full w-full" />
          ) : (
            <span className="text-sm text-black/50">Generando…</span>
          )}
        </div>
        <div className="max-w-md text-left">
          <p className="text-2xl font-semibold text-foreground">Usá tu teléfono como control</p>
          <p className="mt-2 text-xl leading-relaxed text-muted-foreground">
            Escaneá el código con la cámara y controlá Cinéfilo desde el teléfono — buscá por voz o
            texto y elegí qué ver.
          </p>
          {paired ? (
            <p className="mt-4 flex items-center gap-2 text-xl font-semibold text-green-400">
              <Check className="h-6 w-6" /> Teléfono conectado
            </p>
          ) : (
            <p className="mt-4 text-lg text-muted-foreground/60">
              {connecting ? "Conectando…" : "Esperando al teléfono…"}
            </p>
          )}
        </div>
      </div>

      <button
        onClick={onContinue}
        autoFocus
        className="tv-focus rounded-full bg-foreground px-10 py-4 text-2xl font-semibold text-background transition-transform"
      >
        Empezar con el control remoto →
      </button>
    </div>
  );
}
