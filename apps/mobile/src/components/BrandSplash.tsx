// Splash de marca. Cubre el warmup del backend (cold start de Railway) en la
// apertura y también sirve de estado de carga a pantalla completa.
// Lo comparten la app conversacional y el wizard completo.

import { Sparkles, Loader2 } from "lucide-react";

export function BrandSplash({ message }: { message: string }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-6 bg-background px-8 text-center safe-top safe-bottom">
      <div className="flex items-center gap-2">
        <Sparkles className="h-7 w-7 text-primary" />
        <span className="text-2xl font-bold tracking-tight text-foreground">Miru</span>
      </div>
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
