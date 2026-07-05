import { useEffect, useMemo, useState } from "react";
import { Tv, Smartphone, Apple, Radio, Download, QrCode, Loader2 } from "lucide-react";
import QRCode from "qrcode";

// ─────────────────────────────────────────────────────────────────────────────
// Manifest: lo genera/actualiza el script scripts/publish-build.mjs y vive en
// Supabase Storage (bucket público). La landing solo lo lee.
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

function Qr({ value, label }: { value: string; label: string }) {
  const dataUrl = useQr(value);
  if (!dataUrl) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-xl bg-white p-2">
        <img src={dataUrl} alt={label} className="h-32 w-32" />
      </div>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <QrCode className="h-3 w-3" /> {label}
      </span>
    </div>
  );
}

interface CardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  build?: Build;
  qrLabel: string;
  note?: string;
  comingSoon?: boolean;
}

function AppCard({ icon, title, subtitle, build, qrLabel, note, comingSoon }: CardProps) {
  const size = formatSize(build?.size);
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/40 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {comingSoon ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
          Próximamente
        </div>
      ) : build ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3">
            <a
              href={build.url}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
            >
              <Download className="h-4 w-4" /> Descargar APK
            </a>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md bg-background px-2 py-1 font-mono">v{build.version}</span>
              {size && <span>{size}</span>}
            </div>
            {note && <p className="max-w-xs text-xs text-muted-foreground">{note}</p>}
          </div>
          <Qr value={build.url} label={qrLabel} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
          Todavía no hay una versión publicada
        </div>
      )}
    </div>
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
  const webControlUrl = WEB_CONTROL_URL;
  const webControlQr = useQr(webControlUrl);

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
    <div className="safe-top safe-bottom mx-auto flex min-h-full w-full max-w-2xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Ciné<span className="text-primary">filo</span>
        </h1>
        <p className="text-muted-foreground">
          Descargá las apps — para tu tele y tu celular.
        </p>
      </header>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando versiones…
        </div>
      )}

      {status === "error" && (
        <div className="rounded-2xl border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No pudimos cargar las versiones ahora mismo. Probá recargar en un rato.
        </div>
      )}

      {status === "ready" && (
        <main className="flex flex-col gap-4">
          <AppCard
            icon={<Tv className="h-6 w-6" />}
            title="App de TV"
            subtitle="Android TV / Google TV"
            build={apps.tv}
            qrLabel="Escaneá con el tele"
            note="Instalación por sideload: activá 'orígenes desconocidos' en tu Android TV."
          />
          <AppCard
            icon={<Smartphone className="h-6 w-6" />}
            title="App de celular"
            subtitle="Android"
            build={apps["mobile-android"]}
            qrLabel="Escaneá con el celu"
            note="Al instalar el APK, Android puede pedirte permiso para 'orígenes desconocidos'."
          />
          <AppCard
            icon={<Apple className="h-6 w-6" />}
            title="App de iPhone"
            subtitle="iOS"
            qrLabel=""
            comingSoon
          />

          {webControlUrl && (
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/40 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Radio className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold leading-tight">Control remoto</h2>
                  <p className="text-sm text-muted-foreground">
                    Usá el celular como control de la TV, sin instalar nada.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-3">
                  <a
                    href={webControlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary px-4 py-3 font-semibold text-primary transition-colors hover:bg-primary/10 sm:w-auto"
                  >
                    <Radio className="h-4 w-4" /> Abrir el control
                  </a>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    Para controlar tu tele, escaneá el QR que muestra la app de TV.
                  </p>
                </div>
                {webControlQr && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="rounded-xl bg-white p-2">
                      <img src={webControlQr} alt="Control remoto" className="h-32 w-32" />
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <QrCode className="h-3 w-3" /> Abrir en el celu
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      )}

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        {lastUpdated ? `Última actualización: ${lastUpdated}` : "Cinéfilo"}
      </footer>
    </div>
  );
}
