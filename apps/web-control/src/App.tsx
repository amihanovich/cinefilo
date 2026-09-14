// Punto de entrada de la web-control. La URL viene del QR de la TV:
//   https://<tu-dominio>/?session=<id-hex>
// (también aceptamos /control?session= para compatibilidad con el link viejo).
// Sin session: redirect a la versión web touch de Miru (la UI de la TV en modo
// control tradicional, pero clickeable — para tablets y laptops).

import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { ControlScreen } from "./ControlScreen";

const WEB_URL =
  (import.meta.env.VITE_API_BASE_URL ?? "https://miru-ai.up.railway.app") +
  "/tv-lite.html?touch=1";

function readSession(): string {
  try {
    const url = new URL(window.location.href);
    const s = url.searchParams.get("session");
    if (s && /^[0-9a-f]{6,}$/i.test(s)) return s;
  } catch {
    /* noop */
  }
  return "";
}

export function App() {
  const session = useMemo(readSession, []);

  // Llegaste a la URL pelada (sin escanear el QR): te espera la versión web de
  // Miru — la misma experiencia de la TV, tocable. replace() para que el back
  // del navegador no rebote acá y vuelva a redirigir.
  useEffect(() => {
    if (!session) window.location.replace(WEB_URL);
  }, [session]);

  if (!session) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="max-w-xs">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Abriendo Miru…</p>
        </div>
      </main>
    );
  }

  return <ControlScreen session={session} />;
}
