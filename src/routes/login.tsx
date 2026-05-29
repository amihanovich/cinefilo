import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Loader2, ArrowLeft, Heart, Bookmark, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Mode = "signin" | "signup";

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setInfo("Te enviamos un email para confirmar tu cuenta. Revisalo para iniciar sesión.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10 animate-fade-in">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al inicio
        </Link>
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Cinéfilo
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            {mode === "signin" ? "Bienvenido de vuelta" : "Guardá tu perfil de gusto"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Ingresá para recuperar tus preferencias y plataformas."
              : "Para que las recomendaciones se vuelvan tuyas. Sin emails de marketing, sin compartir datos."}
          </p>
        </div>

        {mode === "signup" && (
          <ul className="mb-6 space-y-2.5 rounded-2xl border border-border/60 bg-card/40 p-4">
            <li className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <Heart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="font-medium text-foreground">Aprende qué te gusta</span> — cada 👍 ❤️ afina las recos.</span>
            </li>
            <li className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="font-medium text-foreground">Sincroniza tus Momentos</span> en cualquier dispositivo.</span>
            </li>
            <li className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="font-medium text-foreground">Mejora con cada uso</span> — patrones y horarios tuyos.</span>
            </li>
          </ul>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="min-h-[52px] w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña (mín. 6)"
            className="min-h-[52px] w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary px-6 text-sm font-semibold text-primary-foreground shadow-primary transition-smooth active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {info && (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground">
            {info}
          </div>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "¿No tenés cuenta?" : "¿Ya tenés cuenta?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
            className="font-semibold text-primary hover:underline"
          >
            {mode === "signin" ? "Crear una" : "Ingresá"}
          </button>
        </p>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          o
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={() => navigate({ to: "/" })}
          className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-dashed border-border bg-transparent px-6 text-sm font-medium text-muted-foreground transition-smooth hover:border-primary hover:text-primary"
        >
          Seguir como invitado
        </button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Podés crear tu cuenta más tarde si querés.
        </p>
      </div>
    </main>
  );
}

