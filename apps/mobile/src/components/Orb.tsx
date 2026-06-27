import { useEffect, useRef } from "react";

export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";
export type OrbSize = "full" | "mini";

interface OrbProps {
  phase: OrbPhase;
  size: OrbSize;
  volume?: number; // 0–1, para animar mientras escucha
  onClick?: () => void;
}

export function Orb({ phase, size, volume = 0, onClick }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const isMini = size === "mini";
  const px = isMini ? 48 : 200;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    ctx.scale(dpr, dpr);

    let vol = volume;

    const draw = (ts: number) => {
      const dt = ts - timeRef.current;
      timeRef.current = ts;
      ctx.clearRect(0, 0, px, px);

      const cx = px / 2;
      const cy = px / 2;
      const baseR = px * 0.38;

      // Glow externo
      const glowR = baseR * (1 + (phase === "listening" ? vol * 0.5 : 0));
      const glow = ctx.createRadialGradient(cx, cy, baseR * 0.5, cx, cy, glowR * 2.2);
      glow.addColorStop(0, "rgba(139,92,246,0.35)");
      glow.addColorStop(0.5, "rgba(109,40,217,0.12)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, glowR * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // Esfera base con gradiente
      const t = ts / 1000;
      const breathe =
        phase === "idle" ? Math.sin(t * 0.9) * 0.04
        : phase === "thinking" ? Math.sin(t * 2.2) * 0.06
        : phase === "speaking" ? Math.sin(t * 4) * 0.08
        : 0;
      const r = baseR * (1 + breathe + (phase === "listening" ? vol * 0.18 : 0));

      // Rotación lenta del highlight interno
      const angle = phase === "thinking" ? t * 1.2 : t * 0.3;
      const hx = cx + Math.cos(angle) * r * 0.3;
      const hy = cy + Math.sin(angle) * r * 0.3;

      const sphere = ctx.createRadialGradient(hx, hy, 0, cx, cy, r);
      sphere.addColorStop(0, "#c4b5fd");   // violeta claro — highlight
      sphere.addColorStop(0.35, "#7c3aed"); // violeta medio
      sphere.addColorStop(0.72, "#4c1d95"); // violeta oscuro
      sphere.addColorStop(1, "#1e0a3c");   // casi negro — borde

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = sphere;
      ctx.fill();

      // Anillos de escucha — ondas que salen del centro
      if (phase === "listening" && vol > 0.05) {
        for (let i = 0; i < 3; i++) {
          const age = ((ts / 600 + i * 0.33) % 1);
          const ringR = r + age * r * 1.4;
          const alpha = (1 - age) * vol * 0.6;
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(167,139,250,${alpha})`;
          ctx.lineWidth = isMini ? 1 : 1.5;
          ctx.stroke();
        }
      }

      // Shimmer (speaking)
      if (phase === "speaking") {
        const sh = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
        const shimA = 0.15 + Math.sin(t * 8) * 0.1;
        sh.addColorStop(0, `rgba(255,255,255,${shimA})`);
        sh.addColorStop(0.4, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = sh;
        ctx.fill();
      }

      // Highlight fijo (brillo superior)
      const hi = ctx.createRadialGradient(
        cx - r * 0.28, cy - r * 0.32, 0,
        cx - r * 0.28, cy - r * 0.32, r * 0.55,
      );
      hi.addColorStop(0, "rgba(255,255,255,0.28)");
      hi.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = hi;
      ctx.fill();

      vol = vol * 0.85 + volume * 0.15; // smooth volume
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, px, isMini]); // volume se lee por closure en el loop

  // Actualizar vol en el loop via ref trick
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  return (
    <canvas
      ref={canvasRef}
      width={px}
      height={px}
      style={{ width: px, height: px, cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    />
  );
}
