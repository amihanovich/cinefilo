import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { Session } from "@supabase/supabase-js";
import {
  Loader2,
  ShieldCheck,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Eye,
  Bookmark,
  Trash2,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getProfile,
  setDefaultPlatforms,
  setAgeBracket,
  getTasteCounts,
  deleteAccount,
} from "@/lib/profile.functions";
import { resetTitleFeedback, getTitlesBySentiment } from "@/lib/feedback.functions";
import { PLATFORM_OPTIONS, colorForPlatform, deepLinkFor, type Platform } from "@/lib/recommendations";
import { fetchPostersClient } from "@/lib/itunes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
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

const WATCHLIST_KEY = "cinefilo:watchlist";
const AGE_OPTIONS = ["18-29", "30-45", "46+"] as const;

export function AccountSheet({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  session: Session;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
    enabled: open,
  });
  const tasteQuery = useQuery({
    queryKey: ["taste-counts"],
    queryFn: () => getTasteCounts(),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="tracking-tight">Mi cuenta</SheetTitle>
          <SheetDescription>{session.user.email}</SheetDescription>
        </SheetHeader>

        <div className="space-y-8 py-6">
          <ProfileSecuritySection
            email={session.user.email ?? ""}
            ageBracket={profileQuery.data?.age_bracket ?? null}
            onAgeSaved={() => qc.invalidateQueries({ queryKey: ["profile"] })}
          />

          <Separator />

          <PlatformsSection
            defaultPlatforms={(profileQuery.data?.default_platforms ?? []) as Platform[]}
            onSaved={() => qc.invalidateQueries({ queryKey: ["profile"] })}
          />

          <Separator />

          <ActivitySection
            counts={tasteQuery.data ?? { loved: 0, liked: 0, disliked: 0, seen: 0 }}
            onReset={() => qc.invalidateQueries({ queryKey: ["taste-counts"] })}
          />

          <Separator />

          <DangerSection
            onDeleted={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- A · Perfil y seguridad ---------- */

function ProfileSecuritySection({
  email,
  ageBracket,
  onAgeSaved,
}: {
  email: string;
  ageBracket: string | null;
  onAgeSaved: () => void;
}) {
  const callSetAge = useServerFn(setAgeBracket);
  const [savingAge, setSavingAge] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const handleAge = async (value: (typeof AGE_OPTIONS)[number]) => {
    setSavingAge(true);
    try {
      await callSetAge({ data: { ageBracket: value } });
      onAgeSaved();
      toast.success("Rango de edad actualizado.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setSavingAge(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Contraseña actualizada.");
      setPassword("");
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar.");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Perfil y seguridad
      </h3>

      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</label>
      <input
        value={email}
        disabled
        className="mb-4 min-h-[44px] w-full rounded-xl border border-border bg-muted/40 px-3 text-sm text-muted-foreground"
      />

      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Rango de edad
      </label>
      <div className="mb-5 flex gap-1.5">
        {AGE_OPTIONS.map((opt) => {
          const active = ageBracket === opt;
          return (
            <button
              key={opt}
              disabled={savingAge}
              onClick={() => handleAge(opt)}
              className={cn(
                "min-h-[36px] flex-1 rounded-xl border text-xs font-medium transition-all",
                active
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <form onSubmit={handlePassword} className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">
          Cambiar contraseña
        </label>
        <input
          type="password"
          value={password}
          minLength={6}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nueva contraseña (mín. 6)"
          className="min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <input
          type="password"
          value={confirm}
          minLength={6}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repetir contraseña"
          className="min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={savingPw || password.length === 0}
          className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 text-xs font-semibold text-background transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {savingPw ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Actualizar contraseña
        </button>
      </form>
    </section>
  );
}

/* ---------- B · Plataformas por defecto ---------- */

function PlatformsSection({
  defaultPlatforms,
  onSaved,
}: {
  defaultPlatforms: Platform[];
  onSaved: () => void;
}) {
  const callSave = useServerFn(setDefaultPlatforms);
  const [selected, setSelected] = useState<Platform[]>(defaultPlatforms);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(defaultPlatforms);
  }, [defaultPlatforms]);

  const toggle = (p: Platform) =>
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const dirty =
    JSON.stringify([...selected].sort()) !== JSON.stringify([...defaultPlatforms].sort());

  const handleSave = async () => {
    setSaving(true);
    try {
      await callSave({ data: { platforms: selected } });
      onSaved();
      toast.success("Plataformas guardadas.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Plataformas por defecto
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {(PLATFORM_OPTIONS as Platform[]).map((p) => {
          const active = selected.includes(p);
          return (
            <button
              key={p}
              onClick={() => toggle(p)}
              style={active ? { color: colorForPlatform(p) } : undefined}
              className={cn(
                "inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all",
                active
                  ? "border-transparent bg-white shadow-xs"
                  : "border-border text-muted-foreground/50 hover:text-muted-foreground/80",
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: colorForPlatform(p) }}
              />
              {p}
            </button>
          );
        })}
      </div>
      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-3 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 text-xs font-semibold text-background transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Guardar plataformas
        </button>
      )}
    </section>
  );
}

/* ---------- C · Mis gustos / actividad ---------- */

type GalleryKey = "loved" | "liked" | "seen" | "disliked" | "watchlist";

function ActivitySection({
  counts,
  onReset,
}: {
  counts: { loved: number; liked: number; disliked: number; seen: number };
  onReset: () => void;
}) {
  const callReset = useServerFn(resetTitleFeedback);
  const [resetOpen, setResetOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "preferences" | "seen">("all");
  const [resetting, setResetting] = useState(false);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [gallery, setGallery] = useState<GalleryKey | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(WATCHLIST_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      setWatchlistCount(Array.isArray(arr) ? arr.length : 0);
    } catch {
      setWatchlistCount(0);
    }
  }, []);

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
        onReset();
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

  const stats: { key: GalleryKey; label: string; value: number; Icon: React.ElementType; color: string }[] = [
    { key: "loved",     label: "Me encantó",  value: counts.loved,    Icon: Heart,      color: "text-pink-500" },
    { key: "liked",     label: "Me gustó",    value: counts.liked,    Icon: ThumbsUp,   color: "text-primary" },
    { key: "watchlist", label: "Ver luego",   value: watchlistCount,  Icon: Bookmark,   color: "text-amber-500" },
    { key: "seen",      label: "Ya las vi",   value: counts.seen,     Icon: Eye,        color: "text-muted-foreground" },
    { key: "disliked",  label: "No me gustó", value: counts.disliked, Icon: ThumbsDown, color: "text-destructive" },
  ];

  if (gallery) {
    return (
      <TasteGallery
        galleryKey={gallery}
        label={stats.find((s) => s.key === gallery)!.label}
        onBack={() => setGallery(null)}
      />
    );
  }

  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Mis gustos
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(({ key, label, value, Icon, color }) => (
          <button
            key={key}
            onClick={() => value > 0 && setGallery(key)}
            disabled={value === 0}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl bg-white px-2 py-3 shadow-card transition-all",
              value > 0 ? "hover:shadow-float hover:scale-[1.03] active:scale-[0.98] cursor-pointer" : "opacity-50 cursor-default",
            )}
          >
            <Icon className={cn("h-4 w-4", color)} />
            <span className="text-lg font-bold tracking-tight text-foreground">{value}</span>
            <span className="text-[10px] text-muted-foreground/60">{label}</span>
          </button>
        ))}
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogTrigger asChild>
          <button className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground">
            Resetear mi perfil de gusto
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
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  scope === opt.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40",
                )}
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
              onClick={(e) => { e.preventDefault(); handleReset(); }}
              disabled={resetting}
            >
              {resetting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Borrando…</> : "Resetear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ---------- C1 · Galería de títulos por sentimiento ---------- */

const SENTIMENT_MAP: Record<Exclude<GalleryKey, "watchlist">, "love" | "like" | "dislike" | "seen"> = {
  loved: "love",
  liked: "like",
  disliked: "dislike",
  seen: "seen",
};

function TasteGallery({
  galleryKey,
  label,
  onBack,
}: {
  galleryKey: GalleryKey;
  label: string;
  onBack: () => void;
}) {
  const callGetTitles = useServerFn(getTitlesBySentiment);
  const [items, setItems] = useState<{ title: string; platform: string | null }[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (galleryKey === "watchlist") {
      try {
        const raw = window.localStorage.getItem(WATCHLIST_KEY);
        const arr: string[] = raw ? JSON.parse(raw) : [];
        const watchItems = arr.map((t) => ({ title: t, platform: null }));
        setItems(watchItems);
        if (watchItems.length > 0) {
          fetchPostersClient(watchItems.map((i) => ({ title: i.title, type: "Película" }))).then(setPosters);
        }
      } catch { /* noop */ }
      setLoading(false);
      return;
    }
    callGetTitles({ data: { sentiment: SENTIMENT_MAP[galleryKey] } })
      .then((rows) => {
        setItems(rows);
        if (rows.length > 0) {
          fetchPostersClient(rows.map((r) => ({ title: r.title, type: "Película" }))).then(setPosters);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryKey]);

  return (
    <section className="animate-fade-in">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Volver
      </button>
      <h3 className="mb-4 text-[14px] font-bold tracking-tight text-foreground">{label}</h3>

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="py-6 text-center text-[13px] text-muted-foreground/60">Nada por acá todavía.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <GalleryCard key={item.title} title={item.title} platform={item.platform} poster={posters[item.title] ?? null} />
          ))}
        </div>
      )}
    </section>
  );
}

function GalleryCard({
  title,
  platform,
  poster,
}: {
  title: string;
  platform: string | null;
  poster: string | null;
}) {
  const color = platform ? colorForPlatform(platform as never) : "#6366f1";
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card">
      <div className="relative h-[120px] w-full" style={!poster ? { background: `${color}10` } : undefined}>
        {poster ? (
          <img src={poster} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-3xl font-black opacity-[0.08]" style={{ color }}>{title.charAt(0)}</span>
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground">{title}</p>
        {platform && (
          <div className="mt-1 flex items-center gap-1">
            <span className="h-1 w-1 rounded-full" style={{ background: color }} />
            <span className="text-[9px] text-muted-foreground/60">{platform}</span>
          </div>
        )}
        {platform && (
          <a
            href={deepLinkFor(platform, title)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
            style={{ color }}
          >
            <ExternalLink className="h-2.5 w-2.5" />
            Ver en {platform}
          </a>
        )}
      </div>
    </div>
  );
}

/* ---------- D · Zona peligrosa ---------- */

function DangerSection({ onDeleted }: { onDeleted: () => Promise<void> | void }) {
  const callDelete = useServerFn(deleteAccount);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await callDelete();
      toast.success("Cuenta eliminada.");
      await onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar la cuenta.");
      setDeleting(false);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-destructive/70">
        Zona peligrosa
      </h3>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <button className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-destructive/40 px-4 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/5">
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar mi cuenta
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tu cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción es permanente y borra tu perfil, tus gustos y tu historial. No se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Eliminando…
                </>
              ) : (
                "Sí, eliminar mi cuenta"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
