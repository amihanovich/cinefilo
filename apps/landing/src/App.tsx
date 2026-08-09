import { useEffect, useMemo, useState } from "react";
import { Download, Globe, Loader2, QrCode, Tv } from "lucide-react";
import QRCode from "qrcode";

// ─────────────────────────────────────────────────────────────────────────────
// Manifest: lo genera/actualiza el script scripts/publish-build.mjs y vive en
// Supabase Storage (bucket público). La landing solo lo lee.
//
// La página tiene un único mensaje: bajate la app del celular. La app de TV es
// secundaria — y su instalación NO puede ser un QR, porque los televisores no
// tienen cámara. Va por URL corta tipeada con el control remoto (ver el atajo
// /tv en server.mjs).
// ─────────────────────────────────────────────────────────────────────────────

type AppKey = "tv" | "mobile-android";

interface Build {
  version: string;
  url: string;
  size?: number;
  updatedAt?: string;
}

interface Manifest {
  updatedAt?: string;
  apps: Partial<Record<AppKey, Build>>;
}

const MANIFEST_URL = import.meta.env.VITE_MANIFEST_URL as string | undefined;
const WEB_CONTROL_URL = import.meta.env.VITE_WEB_CONTROL_URL as string | undefined;
// Código numérico de go.aftvnews.com apuntando a <landing>/tv. Downloader lo
// acepta tal cual, así que el usuario tipea solo números con el control remoto
// en vez de una URL larga. Si no está, mostramos la URL.
// Default = el código ya generado en go.aftvnews.com apuntando a <landing>/tv
// (aftv.news/3675666). Va hardcodeado para que la landing muestre el número sin
// depender de la env var; como /tv siempre redirige al último APK del manifest,
// NO hay que regenerarlo en cada release.
const TV_DOWNLOADER_CODE =
  (import.meta.env.VITE_TV_DOWNLOADER_CODE as string | undefined) || "3675666";
// La app móvil servida como web (mismo código que el APK, servicio Railway
// propio): la salida para quien no tiene Android — iPhone, desktop, lo que sea.
const WEB_APP_URL =
  (import.meta.env.VITE_WEB_APP_URL as string | undefined) ||
  "https://webappcinefilo-production.up.railway.app";

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

// QR generado client-side a partir de una URL → data URL para un <img>.
function useQr(value: string | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!value) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(value, {
      margin: 1,
      width: 320,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {
        if (alive) setDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [value]);
  return dataUrl;
}

// En el celular el QR no sirve para nada (no te vas a escanear a vos mismo):
// ahí manda el botón. En la compu manda el QR.
function useIsPhone(): boolean {
  return useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);
}

function MobileHero({ build }: { build?: Build }) {
  const isPhone = useIsPhone();
  const qr = useQr(build?.url);
  const size = formatSize(build?.size);

  return (
    <section className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-muted/40 p-6 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold leading-tight">Cinéfilo en tu celular</h2>
        <p className="text-muted-foreground">
          Decile qué tenés ganas de ver, por voz o escribiendo. Te recomienda y te lo abre en la app
          de streaming que ya tenés.
        </p>
      </div>

      {!build ? (
        <div className="w-full rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Todavía no hay una versión publicada
        </div>
      ) : (
        <>
          <a
            href={build.url}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="h-5 w-5" /> Descargar Cinéfilo
          </a>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Android</span>
            <span className="rounded-md bg-background px-2 py-1 font-mono">v{build.version}</span>
            {size && <span>{size}</span>}
          </div>

          {!isPhone && qr && (
            <div className="flex flex-col items-center gap-2 border-t border-border pt-6">
              <div className="rounded-xl bg-white p-2">
                <img src={qr} alt="Descargar Cinéfilo" className="h-40 w-40" />
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <QrCode className="h-3 w-3" /> O escaneá con el celular
              </span>
            </div>
          )}
        </>
      )}

      {/* Sin Android (iPhone, compu): la misma app corre en el navegador. */}
      <a
        href={WEB_APP_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:text-primary"
      >
        <Globe className="h-4 w-4" /> ¿No tenés Android? Usala en el navegador
      </a>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="text-sm leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

// Instalar en el televisor: sin QR (no hay cámara) y sin Bluetooth (los Android
// TV no reciben archivos). El camino real es tipear una URL corta en la app
// Downloader — de ahí el atajo /tv del server.
function TvSection({ build }: { build?: Build }) {
  const shortUrl = useMemo(() => {
    if (typeof window === "undefined") return "/tv";
    return `${window.location.host}/tv`;
  }, []);

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Tv className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">
            ¿Querés la experiencia completa?
          </h2>
          <p className="text-sm text-muted-foreground">
            Instalá Cinéfilo en tu tele y el celular te queda de control remoto.
          </p>
        </div>
      </div>

      {!build ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
          Todavía no hay una versión publicada
        </div>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            <Step n={1}>
              En el televisor, entrá a la <strong className="text-foreground">Play Store</strong> y
              buscá <strong className="text-foreground">Downloader</strong> (el ícono naranja).
              Instalala.
            </Step>
            <Step n={2}>
              {TV_DOWNLOADER_CODE ? (
                <>
                  Abrí Downloader y escribí este número con el control remoto:
                  <span className="mt-2 block rounded-lg bg-muted px-3 py-2 text-center font-mono text-2xl font-semibold tracking-widest text-foreground">
                    {TV_DOWNLOADER_CODE}
                  </span>
                </>
              ) : (
                <>
                  Abrí Downloader y escribí esta dirección con el control remoto:
                  <span className="mt-2 block break-all rounded-lg bg-muted px-3 py-2 text-center font-mono text-sm text-foreground">
                    {shortUrl}
                  </span>
                </>
              )}
            </Step>
            <Step n={3}>
              Dale <strong className="text-foreground">Go</strong> y después{" "}
              <strong className="text-foreground">Instalar</strong>. El tele te va a pedir permiso
              para instalar apps de origen desconocido: aceptalo, es normal.
            </Step>
          </ol>

          <p className="text-xs text-muted-foreground">
            Después abrí Cinéfilo en el celular y tocá “Conectar TV”.{" "}
            <a href={build.url} className="text-primary underline underline-offset-2">
              ¿Preferís pasarla por pendrive? Descargá el APK
            </a>{" "}
            <span className="font-mono">v{build.version}</span>.
          </p>
        </>
      )}
    </section>
  );
}

export function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!MANIFEST_URL) {
      setStatus("error");
      return;
    }
    let alive = true;
    // cache-bust suave para que un build nuevo aparezca sin esperar CDN.
    fetch(`${MANIFEST_URL}?t=${Math.floor(Date.now() / 60000)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: Manifest) => {
        if (!alive) return;
        setManifest(data);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const apps = manifest?.apps ?? {};

  const lastUpdated = useMemo(() => {
    if (!manifest?.updatedAt) return null;
    try {
      return new Date(manifest.updatedAt).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return null;
    }
  }, [manifest?.updatedAt]);

  return (
    <div className="safe-top safe-bottom mx-auto flex min-h-full w-full max-w-xl flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Ciné<span className="text-primary">filo</span>
        </h1>
        <p className="text-muted-foreground">Qué ver esta noche, resuelto.</p>
      </header>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando…
        </div>
      )}

      {status === "error" && (
        <div className="rounded-2xl border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No pudimos cargar las versiones ahora mismo. Probá recargar en un rato.
        </div>
      )}

      {status === "ready" && (
        <main className="flex flex-col gap-4">
          <MobileHero build={apps["mobile-android"]} />
          <TvSection build={apps.tv} />
        </main>
      )}

      <footer className="mt-auto flex flex-col items-center gap-1 pt-4 text-center text-xs text-muted-foreground">
        {WEB_CONTROL_URL && (
          <a
            href={WEB_CONTROL_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Ya tenés Cinéfilo en la tele: abrir el control desde el navegador
          </a>
        )}
        <span>{lastUpdated ? `Última actualización: ${lastUpdated}` : "Cinéfilo"}</span>
      </footer>
    </div>
  );
}
