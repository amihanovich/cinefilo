// PLACEHOLDER — el QR real + la sesión de Supabase Realtime (useTvSession)
// se conectan en la siguiente etapa. Por ahora esta pantalla solo permite
// avanzar para poder probar el resto del flujo en el browser/emulador.

import { Sparkles } from "lucide-react";

export function PairingScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="tv-safe flex h-screen w-screen flex-col items-center justify-center gap-8 bg-background text-center">
      <div className="flex flex-col items-center gap-4">
        <Sparkles className="h-16 w-16 text-primary" />
        <h1 className="text-6xl font-bold tracking-tight text-foreground">Cinéfilo TV</h1>
        <p className="text-2xl text-muted-foreground">Tu guía para elegir qué ver esta noche</p>
      </div>

      {/* TODO(fase 4/5, Opus): QR local (lib qrcode) + useTvSession → pairing real con /control */}
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-border bg-muted/30 px-12 py-8">
        <p className="text-lg text-muted-foreground">
          Escaneá el código QR con tu teléfono para usarlo como control remoto
        </p>
        <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
          QR próximamente
        </div>
      </div>

      <button
        onClick={onContinue}
        className="tv-focus rounded-full bg-foreground px-10 py-4 text-2xl font-semibold text-background transition-transform"
        autoFocus
      >
        Empezar →
      </button>
    </div>
  );
}
