// La hoja del "+" del composer (como el selector de modelo de Claude), en dos
// partes: "¿Qué buscás?" (el modo: las "habilidades" de Miru, uno a la vez) y
// "¿Dónde busco?" (las plataformas: "Todas" o tu combinación). Lo elegido queda
// guardado y se ve en el composer.

import { Check, Eye, X } from "lucide-react";
import { PLATFORMS, MODES, isAllPlatforms, togglePlatformIn, type ModeId } from "../lib/prefs";
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
  open, selected, onChange, mode, onModeChange, includeSeen, onIncludeSeenChange, onClose,
}: {
  open: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  mode: ModeId | null;
  onModeChange: (next: ModeId | null) => void;
  includeSeen: boolean;
  onIncludeSeenChange: (next: boolean) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const all = isAllPlatforms(selected);
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
      <div className="fade-in fixed inset-x-0 bottom-0 z-[70] max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-card px-5 pb-6 pt-4 shadow-2xl safe-bottom">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />

        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-foreground">¿Qué buscás?</p>
            <p className="text-[12px] text-muted-foreground">Un modo cambia cómo elijo. Tocalo de nuevo para sacarlo.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2" data-testid="modes">
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onModeChange(on ? null : m.id)}
                aria-pressed={on}
                className={`rounded-2xl border px-3 py-2.5 text-left transition-colors active:scale-[0.98] ${on ? "border-primary bg-primary/10" : "border-border bg-background"}`}
              >
                <span className={`block text-[14px] font-semibold ${on ? "text-primary" : "text-foreground"}`}>{m.label}</span>
                <span className="block text-[11.5px] leading-tight text-muted-foreground">{m.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-foreground">¿Dónde busco?</p>
            <p className="text-[12px] text-muted-foreground">
              {all ? "En todas tus plataformas." : "Tocá para sumar o sacar. Si sacás todas, vuelvo a buscar en todas."}
            </p>
          </div>
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

        <div className="my-1 h-px bg-border" />

        {/* Lo marcado "Ya la vi" queda afuera salvo que pidas volver a ver. */}
        <button
          onClick={() => onIncludeSeenChange(!includeSeen)}
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 active:bg-muted"
          aria-pressed={includeSeen}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Eye className="h-4 w-4" />
          </span>
          <span className="flex-1 text-left">
            <span className="block text-[15px] font-semibold text-foreground">Incluir ya vistas</span>
            <span className="block text-[11.5px] leading-tight text-muted-foreground">Para volver a ver alguna que marcaste.</span>
          </span>
          <Switch on={includeSeen} />
        </button>
      </div>
    </>
  );
}
