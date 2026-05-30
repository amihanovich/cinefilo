import { PLATFORM_OPTIONS, colorForPlatform, type Platform } from "@/lib/recommendations";
import { PlatformLogo } from "./PlatformLogo";

// One entry per platform — must match PLATFORM_OPTIONS order (7 items).
// radius: px from orb center; dur: seconds per revolution; angle: starting deg (0 = 3 o'clock);
// dir: 1 = CW, -1 = CCW; opacity/size: visual weight.
const ORBIT_CONFIG = [
  { radius: 106, dur: 26, angle:   0, dir:  1, opacity: 0.50, size: 30 }, // Netflix
  { radius: 122, dur: 34, angle:  51, dir: -1, opacity: 0.34, size: 26 }, // Disney+
  { radius: 114, dur: 22, angle: 103, dir:  1, opacity: 0.44, size: 28 }, // Max
  { radius: 124, dur: 42, angle: 154, dir:  1, opacity: 0.30, size: 26 }, // Prime Video
  { radius: 112, dur: 30, angle: 206, dir: -1, opacity: 0.42, size: 28 }, // Apple TV+
  { radius: 100, dur: 20, angle: 257, dir:  1, opacity: 0.52, size: 30 }, // Paramount+
  { radius: 118, dur: 38, angle: 309, dir: -1, opacity: 0.36, size: 26 }, // Star+
] as const;

export function PlatformOrbit() {
  const platforms = PLATFORM_OPTIONS as Platform[];

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {platforms.map((platform, i) => {
        const { radius, dur, angle, dir, opacity, size } = ORBIT_CONFIG[i];
        // Negative delay offsets the animation to the correct starting angle.
        const delay = `${-(dur * angle) / 360}s`;
        const spinAnim = dir === 1 ? "orbit-spin" : "orbit-spin-rev";
        const revAnim  = dir === 1 ? "orbit-spin-rev" : "orbit-spin";
        const color = colorForPlatform(platform);

        return (
          // Level 1: anchored at center (0×0), rotates to walk the orbit.
          <div
            key={platform}
            className="absolute left-1/2 top-1/2"
            style={{
              width: 0,
              height: 0,
              animation: `${spinAnim} ${dur}s linear infinite`,
              animationDelay: delay,
            }}
          >
            {/* Level 2: translate outward by radius (no animation on this div). */}
            <div style={{ position: "absolute", left: radius, top: 0 }}>
              {/* Level 3: counter-rotate so logo stays upright + center it. */}
              <div
                style={{
                  transform: "translate(-50%, -50%)",
                  animation: `${revAnim} ${dur}s linear infinite`,
                  animationDelay: delay,
                }}
              >
                <PlatformLogo
                  platform={platform}
                  style={{
                    height: size,
                    opacity,
                    filter: `drop-shadow(0 0 8px ${color}70)`,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* Radial fade: dissolves logos near the container edges, keeps focus on center. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 75% at 50% 50%, transparent 42%, oklch(0.986 0.002 275) 78%)",
        }}
      />
    </div>
  );
}
