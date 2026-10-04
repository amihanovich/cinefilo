// La marca de Miru: un destello de cuatro puntas (el mismo ✦ del "por qué te
// la propongo"), en violeta. Reemplaza al orbe en la conversación: el orbe era
// una esfera oscura con brillos que no hacía juego con la interfaz de papel.
// Igual que el asterisco de Claude, la marca ES el indicador de estado:
//   idle      → respira despacio
//   listening → crece con tu voz
//   thinking  → gira despacio
//   speaking  → late
// En las burbujas viejas va quieta (state "still"): solo se mueve lo que está vivo.

import { useId } from "react";

export type MarkState = "still" | "idle" | "listening" | "thinking" | "speaking";

// Cuatro puntas con lados cóncavos, centrado en 50,50.
const PATH = "M50 3 C53.5 33 67 46.5 97 50 C67 53.5 53.5 67 50 97 C46.5 67 33 53.5 3 50 C33 46.5 46.5 33 50 3 Z";

export function MiruMark({ size = 24, state = "still", volume = 0, className = "" }: {
  size?: number;
  state?: MarkState;
  volume?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const anim =
    state === "idle" ? "miru-mark-breathe"
    : state === "thinking" ? "miru-mark-spin"
    : state === "speaking" ? "miru-mark-pulse"
    : "";
  // Escuchando: la escala la maneja el volumen (sin animación CSS que compita).
  const scale = state === "listening" ? 1 + Math.min(volume * 5, 0.45) : 1;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={anim}
        style={{
          transform: state === "listening" ? `scale(${scale})` : undefined,
          transition: state === "listening" ? "transform 90ms linear" : undefined,
          filter: state === "still" ? undefined : "drop-shadow(0 0 6px rgba(120, 90, 230, 0.35))",
          overflow: "visible",
        }}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9B84F2" />
            <stop offset="55%" stopColor="#6B3FC4" />
            <stop offset="100%" stopColor="#5A2FB0" />
          </linearGradient>
        </defs>
        <path d={PATH} fill={`url(#g${id})`} />
      </svg>
    </span>
  );
}
