// Punto de entrada de la web-control. La URL viene del QR de la TV:
//   https://<tu-dominio>/?session=<id-hex>
// (también aceptamos /control?session= para compatibilidad con el link viejo).
// Sin session mostramos una pantalla de ayuda.

import { useMemo } from "react";
import { Tv } from "lucide-react";
import { ControlScreen } from "./ControlScreen";

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

  if (!session) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="max-w-xs">
          <Tv className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">Sin sesión</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Abrí este control escaneando el código QR que aparece en tu Miru TV.
          </p>
        </div>
      </main>
    );
  }

  return <ControlScreen session={session} />;
}
