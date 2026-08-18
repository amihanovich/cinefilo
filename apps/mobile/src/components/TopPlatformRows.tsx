// Tiras "Top 5 en X": el catálogo por plataforma que ves al abrir la app SIN
// buscar nada (debajo del mic de la bienvenida). Los pósters vienen del
// backend (TMDB) — acá no se llama a fetchPostersClient. Si el fetch falla,
// la sección no se renderiza y la bienvenida queda exactamente como antes.

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { fetchTopPlatforms, type TopItem, type TopPlatformRow } from "../lib/api";
import { colorForPlatform, platformLabel, deepLinkFor } from "../lib/deeplink";
import { openInApp } from "../lib/justwatch";
import { useBackLayer } from "../lib/back";

const PLATFORMS_KEY = "miru:platforms";
const CACHE_KEY = "miru:top-platforms"; // sessionStorage: 1 fetch por sesión

function loadUserPlatforms(): string[] {
  try {
    const raw = localStorage.getItem(PLATFORMS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

// Primero las plataformas del usuario; el resto abajo, atenuado pero presente
// (mismo criterio que la TV). Sin filtro: orden del backend.
function orderRows(rows: TopPlatformRow[]): { row: TopPlatformRow; dim: boolean }[] {
  const mine = loadUserPlatforms();
  if (!mine.length) return rows.map((row) => ({ row, dim: false }));
  const isMine = (p: string) => mine.some((m) => m === p || platformLabel(m) === platformLabel(p));
  return [
    ...rows.filter((r) => isMine(r.platform)).map((row) => ({ row, dim: false })),
    ...rows.filter((r) => !isMine(r.platform)).map((row) => ({ row, dim: true })),
  ];
}

// Una tira horizontal: título con el color de la plataforma + 5 pósters
// scrolleables, con fade + chevron mientras haya tiles fuera de vista
// (misma affordance que la TV y que las tarjetas grandes de la app).
function Row({ row, dim, onOpen }: { row: TopPlatformRow; dim: boolean; onOpen: (it: TopItem) => void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const color = colorForPlatform(row.platform);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth > Math.ceil(el.clientWidth + el.scrollLeft) + 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [row.items.length]);

  return (
    <div className={dim ? "opacity-50" : undefined}>
      <h3 className="mb-2 flex items-center gap-2 text-left text-sm font-bold text-foreground">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        Top 5 en {platformLabel(row.platform)}
      </h3>
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={more ? { WebkitMaskImage: "linear-gradient(to right, #000 85%, transparent 100%)", maskImage: "linear-gradient(to right, #000 85%, transparent 100%)" } : undefined}
        >
          {row.items.map((it, i) => (
            <button
              key={it.title}
              onClick={() => onOpen(it)}
              className="relative w-[104px] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-muted text-left active:scale-95 transition-transform"
              aria-label={it.title}
            >
              <div className="h-[156px] w-full overflow-hidden bg-muted">
                {it.posterUrl ? (
                  <img src={it.posterUrl} alt={it.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-muted-foreground">{it.title}</div>
                )}
              </div>
              {/* Nº de ranking, estilo top de plataforma */}
              <span className="absolute bottom-1 left-1.5 text-2xl font-black leading-none text-white [text-shadow:0_2px_6px_rgba(0,0,0,.9)]">{i + 1}</span>
            </button>
          ))}
        </div>
        {more && (
          <ChevronRight className="pointer-events-none absolute right-0 top-1/2 h-6 w-6 -translate-y-1/2 text-white/80 drop-shadow-[0_2px_6px_rgba(0,0,0,.9)]" />
        )}
      </div>
    </div>
  );
}

export function TopPlatformRows() {
  const [rows, setRows] = useState<TopPlatformRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<TopItem | null>(null);

  // El back del sistema cierra la ficha (misma mecánica que el resto de la app).
  useBackLayer(!!detail, () => setDetail(null));

  useEffect(() => {
    let alive = true;
    const cached = ((): TopPlatformRow[] | null => {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        return raw ? (JSON.parse(raw) as TopPlatformRow[]) : null;
      } catch {
        return null;
      }
    })();
    if (cached && cached.length) {
      setRows(cached);
      return;
    }
    fetchTopPlatforms()
      .then((r) => {
        if (!alive) return;
        if (!r.length) { setFailed(true); return; }
        setRows(r);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(r)); } catch { /* llena/privado: da igual */ }
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return null; // sin tiras la bienvenida queda como siempre

  // Skeleton mientras carga (evita el salto de layout al llegar las tiras).
  if (!rows) {
    return (
      <div className="w-full max-w-sm space-y-5 pb-10">
        {[0, 1].map((k) => (
          <div key={k}>
            <div className="mb-2 h-4 w-36 rounded bg-muted" />
            <div className="flex gap-2.5 overflow-hidden">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-[156px] w-[104px] shrink-0 rounded-xl bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const ordered = orderRows(rows);
  const detailColor = detail ? colorForPlatform(detail.platform) : "#888";

  return (
    <div className="w-full max-w-sm space-y-6 pb-10">
      <p className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Lo más visto, plataforma por plataforma
      </p>
      {ordered.map(({ row, dim }) => (
        <Row key={row.platform} row={row} dim={dim} onOpen={setDetail} />
      ))}

      {/* Ficha del título elegido: sinopsis + por qué + Ver ahora. Es una hoja
          propia (la ficha del wizard vive en la pantalla de resultados). */}
      {detail && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setDetail(null)}>
          <div
            className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-background p-5 pb-8 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <div className="flex gap-4">
              <div className="h-40 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
                {detail.posterUrl && <img src={detail.posterUrl} alt={detail.title} className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold leading-snug text-foreground">{detail.title}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: detailColor }}>
                    {platformLabel(detail.platform)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {[detail.type, detail.year].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
            </div>
            {detail.synopsis && (
              <>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">🎬 Sinopsis</p>
                <p className="mt-0.5 text-sm leading-relaxed text-foreground/75">{detail.synopsis}</p>
              </>
            )}
            {detail.reason && (
              <>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-primary">✦ Por qué te la propongo</p>
                <p className="mt-0.5 text-sm leading-relaxed text-foreground/85">{detail.reason}</p>
              </>
            )}
            <button
              onClick={() => void openInApp(detail.platform, deepLinkFor(detail.platform, detail.title), detail.title)}
              className="mt-5 w-full rounded-full py-3 text-center text-sm font-bold text-white active:scale-95"
              style={{ backgroundColor: detailColor }}
            >
              ▶ Ver ahora en {platformLabel(detail.platform)}
            </button>
            <button
              onClick={() => setDetail(null)}
              className="mt-2 w-full rounded-full border border-border py-3 text-center text-sm font-semibold text-muted-foreground active:scale-95"
            >
              Volver
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
