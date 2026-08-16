// La mecánica del orbe, explícita: una píldora-botón pegada al orbe que dice
// SIEMPRE qué hacer y qué está pasando, con color por estado. Es el blend entre
// la esencia del agente (el orbe) y la claridad mecánica del botón del welcome.
// La usan WelcomeScreen y VoiceAgentOverlay — misma ley en
// todas las superficies de voz.

import { Loader2 } from "lucide-react";

export type VoicePillState = "idle" | "listening" | "thinking" | "speaking";

const CFG: Record<VoicePillState, { label: string; cls: string }> = {
  idle: { label: "Tocá para hablar", cls: "bg-primary text-white shadow-[0_0_24px_rgba(136,82,224,0.35)]" },
  listening: { label: "Te escucho · tocá para frenar", cls: "bg-red-500/85 text-white" },
  thinking: { label: "Pensando…", cls: "bg-muted text-muted-foreground" },
  speaking: { label: "Tocá para interrumpir y hablar", cls: "border border-primary/40 bg-primary/15 text-primary" },
};

export function VoicePill({
  state,
  onClick,
  disabled,
}: {
  state: VoicePillState;
  onClick: () => void;
  disabled?: boolean;
}) {
  const cfg = CFG[state];
  return (
    <button
      onClick={onClick}
      disabled={disabled || state === "thinking"}
      className={
        "flex items-center justify-center gap-2 rounded-full px-7 py-3 text-sm font-bold transition-all active:scale-95 disabled:opacity-70 " +
        cfg.cls
      }
    >
      {state === "thinking" && <Loader2 className="h-4 w-4 animate-spin" />}
      {cfg.label}
    </button>
  );
}
