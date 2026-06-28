import { useEffect, useRef } from "react";

export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";
export type OrbSize = "full" | "mini";

interface OrbProps {
  phase: OrbPhase;
  size: OrbSize;
  volume?: number; // 0–1
  onClick?: () => void;
}

export function Orb({ phase, size, volume = 0, onClick }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const isMini = size === "mini";
  const px = isMini ? 48 : 220;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    ctx.scale(dpr, dpr);

    let smoothVol = 0;
    let lastTs = 0;

    const draw = (ts: number) => {
      if (lastTs === 0) lastTs = ts;
      lastTs = ts;
      const t = ts / 1000;

      smoothVol = smoothVol * 0.82 + volumeRef.current * 0.18;

      ctx.clearRect(0, 0, px, px);

      const cx = px / 2;
      const cy = px / 2;
      const maxR = px / 2;
      const baseR = px * 0.36;

      // Clip everything to circle — prevents any square corners
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.clip();

      // ── Ambient background atmosphere ──
      // Dark deep space fill
      const bg = ctx.createRadialGradient(cx, cy - px * 0.1, 0, cx, cy, maxR);
      if (phase === "idle") {
        bg.addColorStop(0, "rgba(60,20,90,1)");
        bg.addColorStop(0.5, "rgba(20,5,40,1)");
        bg.addColorStop(1, "rgba(5,0,15,1)");
      } else if (phase === "listening") {
        bg.addColorStop(0, "rgba(80,20,120,1)");
        bg.addColorStop(0.5, "rgba(30,5,60,1)");
        bg.addColorStop(1, "rgba(5,0,20,1)");
      } else if (phase === "thinking") {
        bg.addColorStop(0, "rgba(20,40,100,1)");
        bg.addColorStop(0.5, "rgba(10,15,50,1)");
        bg.addColorStop(1, "rgba(2,3,15,1)");
      } else {
        bg.addColorStop(0, "rgba(100,20,80,1)");
        bg.addColorStop(0.5, "rgba(40,5,30,1)");
        bg.addColorStop(1, "rgba(8,0,12,1)");
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, px, px);

      ctx.restore();

      // ── Outer halo (outside sphere, inside canvas circle) ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.clip();

      const haloAlpha =
        phase === "idle" ? 0.18 + Math.sin(t * 0.8) * 0.04
        : phase === "listening" ? 0.28 + smoothVol * 0.35
        : phase === "thinking" ? 0.22 + Math.sin(t * 1.8) * 0.06
        : 0.35 + Math.sin(t * 4) * 0.08;

      const haloColor =
        phase === "thinking" ? `rgba(100,140,255,${haloAlpha})`
        : phase === "speaking" ? `rgba(220,80,180,${haloAlpha})`
        : `rgba(160,80,255,${haloAlpha})`;

      const halo = ctx.createRadialGradient(cx, cy, baseR * 0.9, cx, cy, maxR * 0.98);
      halo.addColorStop(0, haloColor);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, px, px);

      ctx.restore();

      // ── Listening rings (audio ripples) ──
      if (phase === "listening" && smoothVol > 0.03) {
        for (let i = 0; i < 3; i++) {
          const offset = i / 3;
          const age = ((t * 0.7 + offset) % 1);
          const ringR = baseR + age * baseR * 0.85;
          const alpha = (1 - age) * smoothVol * 0.7;
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(180,100,255,${alpha})`;
          ctx.lineWidth = isMini ? 1 : 1.8;
          ctx.stroke();
        }
      }

      // ── Sphere breathing ──
      const breathe =
        phase === "idle" ? Math.sin(t * 0.75) * 0.035
        : phase === "thinking" ? Math.sin(t * 2) * 0.05
        : phase === "speaking" ? Math.sin(t * 3.5) * 0.07
        : 0;
      const r = baseR * (1 + breathe + (phase === "listening" ? smoothVol * 0.2 : 0));

      // ── Sphere gradient ──
      const highlightAngle = phase === "thinking" ? t * 1.1 : t * 0.2;
      const hx = cx + Math.cos(highlightAngle) * r * 0.28;
      const hy = cy + Math.sin(highlightAngle) * r * 0.28 - r * 0.05;

      const sphere = ctx.createRadialGradient(hx, hy, 0, cx, cy, r);
      if (phase === "idle") {
        sphere.addColorStop(0, "#d8b4fe");   // lavender highlight
        sphere.addColorStop(0.25, "#a855f7"); // vivid purple
        sphere.addColorStop(0.55, "#6d28d9"); // deep violet
        sphere.addColorStop(0.82, "#2e1065"); // very dark purple
        sphere.addColorStop(1, "#0d0020");   // near black edge
      } else if (phase === "listening") {
        const li = 0.8 + smoothVol * 0.4;
        sphere.addColorStop(0, `rgba(240,200,255,${Math.min(1, li)})`);
        sphere.addColorStop(0.25, "#c026d3"); // fuchsia
        sphere.addColorStop(0.55, "#7e22ce");
        sphere.addColorStop(0.82, "#3b0764");
        sphere.addColorStop(1, "#0d0020");
      } else if (phase === "thinking") {
        sphere.addColorStop(0, "#bfdbfe");   // blue-white
        sphere.addColorStop(0.25, "#3b82f6"); // blue
        sphere.addColorStop(0.55, "#1e40af"); // deep blue
        sphere.addColorStop(0.82, "#0c1a4a");
        sphere.addColorStop(1, "#000510");
      } else {
        // speaking
        const spk = 0.8 + Math.sin(t * 5) * 0.2;
        sphere.addColorStop(0, `rgba(255,200,240,${spk})`);
        sphere.addColorStop(0.25, "#e879f9"); // pink-fuchsia
        sphere.addColorStop(0.55, "#9333ea");
        sphere.addColorStop(0.82, "#3b0764");
        sphere.addColorStop(1, "#0d0020");
      }

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = sphere;
      ctx.fill();

      // ── Rim light (3D depth) ──
      const rim = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
      const rimColor = phase === "thinking" ? "rgba(100,160,255,0.22)" : "rgba(200,100,255,0.18)";
      rim.addColorStop(0, "rgba(0,0,0,0)");
      rim.addColorStop(0.7, "rgba(0,0,0,0)");
      rim.addColorStop(1, rimColor);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = rim;
      ctx.fill();

      // ── Specular highlight (top-left gloss) ──
      const specR = r * (isMini ? 0.38 : 0.42);
      const specX = cx - r * 0.25;
      const specY = cy - r * 0.3;
      const spec = ctx.createRadialGradient(specX, specY, 0, specX, specY, specR);
      spec.addColorStop(0, "rgba(255,255,255,0.55)");
      spec.addColorStop(0.4, "rgba(255,255,255,0.12)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = spec;
      ctx.fill();

      // ── Thinking orbit dot ──
      if (phase === "thinking" && !isMini) {
        const orbitR = r * 1.22;
        const dotAngle = t * 2.4;
        const dotX = cx + Math.cos(dotAngle) * orbitR;
        const dotY = cy + Math.sin(dotAngle) * orbitR;
        const dotSize = px * 0.028;

        // Dot glow
        const dotGlow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, dotSize * 3);
        dotGlow.addColorStop(0, "rgba(147,197,253,0.6)");
        dotGlow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotSize * 3, 0, Math.PI * 2);
        ctx.fillStyle = dotGlow;
        ctx.fill();

        // Dot core
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(219,234,254,0.95)";
        ctx.fill();
      }

      // ── Speaking shimmer pulse ──
      if (phase === "speaking" && !isMini) {
        const shA = 0.12 + Math.abs(Math.sin(t * 6)) * 0.14;
        const shimmer = ctx.createRadialGradient(cx, cy - r * 0.1, 0, cx, cy, r);
        shimmer.addColorStop(0, `rgba(255,255,255,${shA})`);
        shimmer.addColorStop(0.5, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = shimmer;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, px, isMini]);

  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
    >
      <canvas
        ref={canvasRef}
        width={px}
        height={px}
        style={{ width: px, height: px, display: "block" }}
      />
    </div>
  );
}
