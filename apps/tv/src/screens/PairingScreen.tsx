// Pantalla principal de la TV: panel de pairing a la izquierda (QR + copy),
// grilla de pósters reales de tendencias a la derecha (estilo Flow/operadoras).
//
// El QR grande apunta a /control (funciona HOY, sin instalar nada — abre en
// cualquier navegador del teléfono). Si en el futuro se publica la app móvil
// con la función de control integrada y se configura Android App Links /
// Universal Links para ese mismo dominio, el sistema operativo empieza a abrir
// la app instalada en vez del navegador automáticamente — sin tocar este QR.
//
// El QR chico de "descargar la app" solo aparece si VITE_MOBILE_APP_URL está
// configurada (todavía no existe): mientras tanto se muestra un aviso
// informativo "Próximamente en Google Play".

import { useEffect, useState, type MutableRefObject } from "react";
import { Sparkles, Check, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { useDpad, type DpadBridge } from "../hooks/useDpad";
import { cn } from "../lib/tv-utils";
import { fetchTvHome, type TvHomeItem } from "../lib/tv-home";
import { fetchPostersClient } from "../lib/posters";
import { colorForPlatform, platformLabel } from "../lib/deeplink";

const MOBILE_APP_URL = import.meta.env.VITE_MOBILE_APP_URL as string | undefined;
const HERO_COUNT = 12;

interface PairingScreenProps {
  qrUrl: string;
  paired: boolean;
  connecting: boolean;
  onContinue: () => void;
  onBack: () => void;
  bridgeRef: MutableRefObject<DpadBridge | null>;
}

export function PairingScreen({ qrUrl, paired, connecting, onContinue, onBack, bridgeRef }: PairingScreenProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [appQrDataUrl, setAppQrDataUrl] = useState<string | null>(null);
  const [heroItems, setHeroItems] = useState<TvHomeItem[]>([]);
  const [heroPosters, setHeroPosters] = useState<Record<string, string | null>>({});

  const dpad = useDpad({
    rows: [{ id: "empezar", count: 1 }],
    onSelect: onContinue,
    onBack,
  });

  useEffect(() => {
    bridgeRef.current = { move: dpad.move, select: dpad.select, setFocus: dpad.setFocus };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, dpad.move, dpad.select, dpad.setFocus]);

  // QR principal — control web, funciona hoy.
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(qrUrl, { width: 320, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => alive && setQrDataUrl(url))
      .catch(() => {
        /* si falla, igual se puede continuar con el control remoto físico */
      });
    return () => {
      alive = false;
    };
  }, [qrUrl]);

  // QR secundario — solo si ya existe el link real de Play Store.
  useEffect(() => {
    if (!MOBILE_APP_URL) return;
    let alive = true;
    QRCode.toDataURL(MOBILE_APP_URL, { width: 160, margin: 1 })
      .then((url) => alive && setAppQrDataUrl(url))
      .catch(() => {
        /* sin QR secundario, no pasa nada */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Pósters reales de tendencias (mismo endpoint que usa el home de tv-lite).
  useEffect(() => {
    let alive = true;
    void fetchTvHome().then((items) => {
      if (!alive) return;
      const picked = items.slice(0, HERO_COUNT);
      setHeroItems(picked);
      void fetchPostersClient(picked.map((i) => ({ title: i.title, type: i.type, year: i.year ? String(i.year) : undefined }))).then(
        (posters) => alive && setHeroPosters(posters),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex h-screen w-screen bg-background">
      {/* Panel izquierdo: branding + QR + copy */}
      <div className="tv-safe flex w-1/2 shrink-0 flex-col justify-center gap-6 border-r border-border bg-muted/10">
        <div className="flex items-center gap-3">
          <Sparkles className="h-9 w-9 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Cinéfilo TV</h1>
            <p className="text-base text-muted-foreground">Tu guía para elegir qué ver esta noche</p>
          </div>
        </div>

        <div className="flex items-center gap-5 rounded-2xl border border-border bg-background/60 p-5">
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl bg-white p-2">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR para vincular el teléfono" className="h-full w-full" />
            ) : (
              <span className="text-xs text-black/50">Generando…</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-foreground">Escaneá con tu celular</p>
            {paired ? (
              <p className="mt-1 flex items-center gap-1.5 text-base font-semibold text-green-400">
                <Check className="h-4 w-4" /> Teléfono conectado
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground/70">
                {connecting ? "Conectando…" : "Esperando…"}
              </p>
            )}
          </div>
        </div>

        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground/90">¿Ya tenés la app de Cinéfilo?</span> Escaneá y se conecta al
          instante. <span className="text-foreground/90">¿Todavía no la tenés?</span> El mismo código te
          deja controlar todo desde el navegador, sin instalar nada.
        </p>

        {/* Descarga de la app móvil: real si hay link, informativo si no */}
        {MOBILE_APP_URL && appQrDataUrl ? (
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-background/60 p-4">
            <img src={appQrDataUrl} alt="QR para descargar la app" className="h-16 w-16 rounded-lg bg-white p-1" />
            <div>
              <p className="text-sm font-semibold text-foreground">Descargá la app completa</p>
              <p className="text-xs text-muted-foreground/70">Voz, notificaciones y más — Google Play</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
            <Smartphone className="h-4 w-4" />
            Próximamente: app completa en Google Play
          </div>
        )}

        <button
          onClick={onContinue}
          className={cn(
            "w-fit rounded-full bg-foreground px-8 py-3.5 text-lg font-semibold text-background transition-transform",
            dpad.isFocused("empezar", 0) && "tv-focus",
          )}
        >
          Empezar con el control remoto →
        </button>
      </div>

      {/* Panel derecho: grilla de pósters reales de tendencias */}
      <div className="grid flex-1 grid-cols-4 grid-rows-3 gap-3 p-6">
        {(heroItems.length > 0 ? heroItems : Array.from({ length: HERO_COUNT })).map((item, i) => {
          const it = item as TvHomeItem | undefined;
          const poster = it ? heroPosters[it.title] : undefined;
          const color = it ? colorForPlatform(it.platform) : "#6d28d9";
          return (
            <div key={it?.title ?? i} className="relative overflow-hidden rounded-2xl bg-muted/30">
              {poster ? (
                <img src={poster} alt={it?.title} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full animate-pulse bg-muted" />
              )}
              {it && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-8">
                  <p className="truncate text-sm font-semibold text-white">{it.title}</p>
                  <span
                    className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {platformLabel(it.platform)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
