// "¿Dónde busco?": el selector de plataformas de la conversación, que se abre
// con el "+" del composer (como el selector de modelo de Claude). "Todas" o la
// combinación que armes; la elección queda guardada y se ve en el composer.

import { Check, X } from "lucide-react";
import { PLATFORMS, isAllPlatforms, togglePlatformIn } from "../lib/prefs";
import { platformLabel } from "../lib/deeplink";
import { PlatformIcon } from "./PlatformIcon";

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted ring-1 ring-border"}`}
      aria-hidden
    >
      <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </span>
  );
}

export function PlatformSheet({
  open, selected, onChange, onClose,
}: {
  open: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const all = isAllPlatforms(selected);
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div className="fade-in fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl border-t border-border bg-card px-5 pb-6 pt-4 shadow-2xl safe-bottom">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-foreground">¿Dónde busco?</p>
            <p className="text-[12px] text-muted-foreground">
              {all ? "En todas tus plataformas." : "Tocá para sumar o sacar. Si sacás todas, vuelvo a buscar en todas."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90">
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => onChange([...PLATFORMS])}
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 active:bg-muted"
          aria-pressed={all}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Check className="h-4 w-4" />
          </span>
          <span className="flex-1 text-left text-[15px] font-semibold text-foreground">Todas las plataformas</span>
          <Switch on={all} />
        </button>

        <div className="my-1 h-px bg-border" />

        {PLATFORMS.map((p) => {
          const on = !all && selected.includes(p);
          return (
            <button
              key={p}
              onClick={() => onChange(togglePlatformIn(selected, p))}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 active:bg-muted"
              aria-pressed={on}
            >
              <PlatformIcon platform={p} size={28} />
              <span className={`flex-1 text-left text-[15px] ${on ? "font-semibold text-foreground" : "text-foreground/80"}`}>{platformLabel(p)}</span>
              <Switch on={on} />
            </button>
          );
        })}
      </div>
    </>
  );
}
