// Splash de marca. Cubre el warmup del backend (cold start de Railway) en la
// apertura y también sirve de estado de carga a pantalla completa.
// Lo comparten la app conversacional y el wizard completo.

import { MiruMark } from "./MiruMark";

export function BrandSplash({ message }: { message: string }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-6 bg-background px-8 text-center safe-top safe-bottom">
      <MiruMark size={56} state="thinking" />
      <span className="font-serif text-3xl font-bold tracking-tight text-foreground">Miru</span>
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
