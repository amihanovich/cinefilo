// Mini ícono de una plataforma: su favicon real, y si no carga, la inicial en
// el color de la marca (nunca un hueco).

import { useState } from "react";
import { colorForPlatform, faviconFor, platformLabel, textOnPlatform } from "../lib/deeplink";

export function PlatformIcon({ platform, size = 18, className = "" }: { platform: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconFor(platform);
  const label = platformLabel(platform);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={label}
        title={label}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-[5px] bg-white object-contain ring-1 ring-border ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-[5px] font-black leading-none ${className}`}
      style={{ width: size, height: size, backgroundColor: colorForPlatform(platform), color: textOnPlatform(platform), fontSize: Math.round(size * 0.55) }}
    >
      {label.charAt(0)}
    </span>
  );
}
