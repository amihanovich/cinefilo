import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, Sparkles, LogIn, RotateCcw, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { resetTitleFeedback } from "@/lib/feedback.functions";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "preferences" | "seen">("all");
  const [resetting, setResetting] = useState(false);
  const callReset = useServerFn(resetTitleFeedback);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await callReset({ data: { scope } });
      if (res.ok) {
        toast.success(
          scope === "all"
            ? `Perfil reseteado (${res.deleted} registros).`
            : scope === "preferences"
              ? `Borré tus me gusta / me encanta (${res.deleted}).`
              : `Borré tu historial de "ya las vi" (${res.deleted}).`,
        );
        qc.invalidateQueries();
        setResetOpen(false);
      } else {
        toast.error("No se pudo resetear. Probá de nuevo.");
      }
    } catch {
      toast.error("No se pudo resetear. Probá de nuevo.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 sm:px-8">
          <Link
            to="/"
            onClick={() => window.dispatchEvent(new CustomEvent("que-veo:go-home"))}
            className="inline-flex items-center gap-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground">
              <Sparkles className="h-4 w-4 text-background" />
            </div>
            <span className="text-sm font-bold text-foreground">QueVeo</span>
          </Link>

          <div className="flex items-center gap-2">
            {session ? (
              <>
                <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                  <AlertDialogTrigger asChild>
                    <button
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Resetear mis intereses"
                      title="Resetear mis intereses"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Resetear tu perfil de gusto</AlertDialogTitle>
                      <AlertDialogDescription>
                        Útil si otra persona va a usar la app con tu cuenta. Elegí qué borrar:
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 py-2">
                      {(
                        [
                          { id: "all", label: "Todo", hint: "Me gusta, me encanta y ya las vi" },
                          { id: "preferences", label: "Solo preferencias", hint: "Me gusta y me encanta" },
                          { id: "seen", label: 'Solo "ya las vi"', hint: "Historial de descartes" },
                        ] as const
                      ).map((opt) => (
                        <label
                          key={opt.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                            scope === opt.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/40"
                          }`}
                        >
                          <input
                            type="radio"
                            name="reset-scope"
                            className="mt-1 accent-primary"
                            checked={scope === opt.id}
                            onChange={() => setScope(opt.id)}
                          />
                          <span>
                            <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                            <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={resetting}>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          handleReset();
                        }}
                        disabled={resetting}
                      >
                        {resetting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Borrando…
                          </>
                        ) : (
                          "Resetear"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <button
                  onClick={handleLogout}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Cerrar sesión"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-semibold text-background transition-colors hover:bg-foreground/85"
              >
                <LogIn className="h-3.5 w-3.5" />
                Iniciar sesión
              </Link>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
