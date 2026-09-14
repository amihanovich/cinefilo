// Tira "Abiertos recientemente": lo que abriste desde Miru, para volver a
// abrirlo en la misma plataforma con un toque. Solo registro de aperturas
// (ver lib/opened.ts) — no promete progreso de reproducción.
import { useState } from "react";
import { ChevronDown, History, X } from "lucide-react";
import { platformLabel } from "../lib/deeplink";
import { timeAgo, type OpenedItem } from "../lib/opened";

interface Props {
  items: OpenedItem[];
  onOpen: (item: OpenedItem) => void;
  onRemove?: (item: OpenedItem) => void;
  /** Abierta de entrada (bienvenida) o comprimida en un chip (resultados). */
  defaultOpen?: boolean;
}

export function RecentOpened({ items, onOpen, onRemove, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
  return (
    <div className="mt-4 w-full">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-[12px] font-semibold text-foreground transition-transform active:scale-95"
        aria-label={open ? "Ocultar abiertos recientemente" : "Ver abiertos recientemente"}
      >
        <History className="h-3.5 w-3.5 text-primary" />
        Abiertos recientemente · {items.length}
        <ChevronDown className={"h-3.5 w-3.5 text-muted-foreground transition-transform" + (open ? " rotate-180" : "")} />
      </button>
      {open && (
        <div className="mt-2 flex gap-2.5 overflow-x-auto pb-1">
          {items.map((o) => (
            <div key={o.title + "|" + o.platform} className="relative w-[4.5rem] shrink-0">
              <button
                onClick={() => onOpen(o)}
                className="block w-full overflow-hidden rounded-lg border border-border bg-muted text-left transition-transform active:scale-95"
                aria-label={`Volver a abrir ${o.title} en ${platformLabel(o.platform)}`}
              >
                {o.posterUrl ? (
                  <img src={o.posterUrl} alt={o.title} className="h-24 w-full object-cover" />
                ) : (
                  <span className="flex h-24 items-center justify-center p-1 text-center text-[9px] leading-tight text-muted-foreground">{o.title}</span>
                )}
              </button>
              <p className="mt-1 truncate text-[10px] font-semibold text-foreground">{o.title}</p>
              <p className="truncate text-[9px] text-muted-foreground">
                {platformLabel(o.platform)} · {timeAgo(o.openedAt)}
              </p>
              {onRemove && (
                <button
                  onClick={() => onRemove(o)}
                  aria-label={`Quitar ${o.title}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-transform active:scale-90"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {open && (
        <p className="mt-1 text-[10px] text-muted-foreground/60">Tocá para volver a abrirla en la plataforma · solo lo que abriste desde Miru</p>
      )}
    </div>
  );
}
