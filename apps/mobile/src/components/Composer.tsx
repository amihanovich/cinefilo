// El composer de la conversación, a la manera de Claude: el texto arriba y una
// fila de controles abajo —
//   [+]  ·  [dónde busco: "Todas" o los mini favicons]  ·····  [mic]  [● voz / ↑ enviar]
// El "+" y la pastilla abren "¿Dónde busco?". El mic DICTA al cuadro (no
// envía: revisás y mandás). El botón violeta es el modo voz cuando no hay
// texto y se vuelve "enviar" apenas escribís — igual que el negro de Claude.

import { useEffect, useRef } from "react";
import { Plus, Mic, ArrowUp, AudioLines, Loader2 } from "lucide-react";
import { isAllPlatforms } from "../lib/prefs";
import { PlatformIcon } from "./PlatformIcon";

export type DictationState = "idle" | "requesting" | "rec" | "processing";

export function Composer({
  value, onChange, onSend, busy, platforms, onOpenPlatforms, dictation, onDictate, onVoiceMode,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  platforms: string[];
  onOpenPlatforms: () => void;
  dictation: DictationState;
  onDictate: () => void;
  onVoiceMode: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Crece con el texto (hasta ~5 líneas), como el de Claude.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  const all = isAllPlatforms(platforms);
  const hasText = value.trim().length > 0;
  const recording = dictation === "rec";
  const transcribing = dictation === "processing" || dictation === "requesting";

  return (
    <div className="rounded-[28px] border border-border bg-card px-4 pb-3 pt-3 shadow-[0_1px_4px_rgba(41,35,31,0.08)]">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (hasText && !busy) onSend(); }
        }}
        placeholder={recording ? "Te escucho… tocá el micrófono para frenar" : transcribing ? "Pasándolo a texto…" : "Pedile algo a Miru…"}
        disabled={recording}
        className="block max-h-[132px] min-h-[28px] w-full resize-none bg-transparent px-1 text-[16px] leading-snug text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />

      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={onOpenPlatforms}
          aria-label="Elegir dónde buscar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground/80 transition-transform active:scale-90"
        >
          <Plus className="h-5 w-5" />
        </button>

        {/* Dónde está buscando: "Todas", o los mini favicons de tu combinación. */}
        <button
          onClick={onOpenPlatforms}
          aria-label={all ? "Buscando en todas las plataformas" : `Buscando en ${platforms.join(", ")}`}
          className="flex h-10 min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 transition-transform active:scale-95"
        >
          {all ? (
            <span className="text-[13px] font-semibold text-foreground/80">Todas</span>
          ) : (
            <span className="flex items-center gap-1" data-testid="platform-icons">
              {platforms.map((p) => <PlatformIcon key={p} platform={p} size={18} />)}
            </span>
          )}
        </button>

        <div className="flex-1" />

        <button
          onClick={onDictate}
          aria-label={recording ? "Frenar el dictado" : "Dictar"}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 ${
            recording ? "bg-red-500 text-white" : "bg-muted text-foreground/70"
          }`}
        >
          {transcribing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
          {recording && <span className="pointer-events-none absolute inset-0 rounded-full bg-red-500/40 animate-ping" />}
        </button>

        <button
          onClick={hasText ? onSend : onVoiceMode}
          disabled={busy && hasText}
          aria-label={hasText ? "Enviar" : "Hablar con Miru"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-90 disabled:opacity-40"
        >
          {hasText ? <ArrowUp className="h-5 w-5" strokeWidth={2.5} /> : <AudioLines className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
