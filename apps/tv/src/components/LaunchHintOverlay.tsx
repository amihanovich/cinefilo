// Overlay de fallback cuando no se pudo abrir la app de streaming en la TV.
// Se renderiza a nivel App (sobre cualquier pantalla). Captura las teclas en
// fase de CAPTURA con stopImmediatePropagation, así el dpad de la pantalla de
// fondo no reacciona mientras el overlay está abierto — sin tener que pasarle
// un flag a cada pantalla.

import { useEffect } from "react";
import { X } from "lucide-react";
import { App as CapacitorApp } from "@capacitor/app";
import { colorForPlatform, platformLabel } from "../lib/deeplink";

interface Props {
  hint: { title: string; platform: string };
  onDismiss: () => void;
}

export function LaunchHintOverlay({ hint, onDismiss }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Bloquea que la tecla llegue al dpad de la pantalla de fondo.
      e.stopImmediatePropagation();
      e.preventDefault();
      // Cualquier OK / Back / Escape cierra.
      onDismiss();
    };
    window.addEventListener("keydown", handler, true); // capture
    let remove: (() => void) | undefined;
    void CapacitorApp.addListener("backButton", () => onDismiss()).then((h) => {
      remove = () => h.remove();
    });
    return () => {
      window.removeEventListener("keydown", handler, true);
      remove?.();
    };
  }, [onDismiss]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onDismiss}>
      <div className="flex max-w-2xl flex-col items-center gap-4 rounded-3xl border-2 border-border bg-background px-16 py-12 text-center">
        <span
          className="rounded-full px-5 py-2 text-2xl font-bold text-white"
          style={{ backgroundColor: colorForPlatform(hint.platform) }}
        >
          {platformLabel(hint.platform)}
        </span>
        <p className="text-3xl font-semibold text-foreground">Abrí {platformLabel(hint.platform)} en tu TV</p>
        <p className="text-2xl text-muted-foreground">
          y buscá <span className="font-semibold text-foreground">«{hint.title}»</span>
        </p>
        <div className="tv-focus mt-4 flex items-center gap-2 rounded-full border-2 border-border px-8 py-3 text-xl font-semibold text-foreground">
          <X className="h-5 w-5" /> Presioná cualquier tecla para cerrar
        </div>
      </div>
    </div>
  );
}
