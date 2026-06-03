import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, Sparkles, UserCog } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AccountSheet } from "@/components/AccountSheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const initial = (session?.user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/90 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3 sm:px-8">
          <Link
            to="/"
            onClick={() => window.dispatchEvent(new CustomEvent("que-veo:go-home"))}
            className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-70"
          >
            <Sparkles className="h-7 w-7 text-primary" />
            <span className="text-[30px] font-semibold tracking-tight text-foreground">
              Cinéfilo
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex items-center justify-center rounded-full outline-none transition-opacity hover:opacity-80"
                    aria-label="Mi cuenta"
                  >
                    <Avatar className="h-14 w-14">
                      <AvatarFallback className="bg-foreground text-[22px] font-semibold text-background">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setAccountOpen(true)}>
                    <UserCog className="mr-2 h-4 w-4" />
                    Mi cuenta
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                to="/login"
                className="inline-flex h-8 items-center rounded-full bg-foreground px-4 text-xs font-semibold text-background transition-opacity hover:opacity-80"
              >
                Iniciar sesión
              </Link>
            )}
          </div>
        </div>
      </header>
      <Outlet />
      {session && (
        <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} session={session} />
      )}
    </div>
  );
}
