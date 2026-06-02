import { useState } from "react";
import { Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { upsertPresence, removePresence, saveDisplayName } from "@/lib/social.functions";
import { toast } from "sonner";

const AVATAR_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444",
];

type Props = {
  active: boolean;
  onActivate: (location: { lat: number; lng: number }) => void;
  onDeactivate: () => void;
};

export function SocialModeToggle({ active, onActivate, onDeactivate }: Props) {
  const [loading, setLoading] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);

  const getLocation = (): Promise<GeolocationCoordinates> =>
    new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        reject,
        { maximumAge: 60_000, timeout: 8_000 },
      ),
    );

  const handleEnable = async () => {
    if (!displayName.trim()) {
      setShowNamePrompt(true);
      return;
    }
    setLoading(true);
    try {
      const coords = await getLocation();
      const lat = parseFloat(coords.latitude.toFixed(2));
      const lng = parseFloat(coords.longitude.toFixed(2));
      await saveDisplayName({ data: { displayName: displayName.trim(), avatarColor } });
      await upsertPresence({ data: { lat, lng, displayName: displayName.trim(), avatarColor } });
      setShowNamePrompt(false);
      onActivate({ lat, lng });
      toast.success("Modo Social activado — buscando matches cerca tuyo");
    } catch {
      toast.error("No pudimos obtener tu ubicación. Permitila en el navegador.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      await removePresence();
      onDeactivate();
    } catch {
      onDeactivate();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {showNamePrompt && !active && (
        <div className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-float animate-fade-in">
          <p className="mb-3 text-[13px] font-semibold text-foreground">¿Cómo querés que te vean?</p>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleEnable(); }}
            placeholder="Tu nombre o apodo"
            maxLength={40}
            autoFocus
            className="w-full rounded-xl border border-black/[0.08] bg-transparent px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="mt-3 flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setAvatarColor(c)}
                className={cn("h-6 w-6 rounded-full transition-transform", avatarColor === c && "scale-125 ring-2 ring-offset-1 ring-foreground/20")}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleEnable}
              disabled={loading || displayName.trim().length < 1}
              className="flex-1 rounded-xl bg-foreground py-2 text-[12px] font-semibold text-background disabled:opacity-40"
            >
              {loading ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : "Activar"}
            </button>
            <button
              onClick={() => setShowNamePrompt(false)}
              className="rounded-xl px-3 py-2 text-[12px] text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <button
        onClick={active ? handleDisable : () => setShowNamePrompt(true)}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium transition-all",
          active
            ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
            : "bg-white/80 text-muted-foreground/70 shadow-xs hover:text-foreground",
          loading && "opacity-60",
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Users className={cn("h-3.5 w-3.5", active && "text-green-500")} />
        )}
        {active ? (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Modo Social activo
          </span>
        ) : (
          "Modo Social"
        )}
      </button>
    </div>
  );
}
