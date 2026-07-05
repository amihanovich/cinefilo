// Utilidades del "control remoto de TV" en la app móvil: persistencia de la
// sesión, parseo del QR de la TV y escaneo con la cámara.
//
// El QR de la TV codifica  https://<host>/control?session=<id>  — la app no
// abre esa URL, solo extrae el session id y se conecta al mismo canal Realtime
// (lado "control" del protocolo). Así el móvil reemplaza a la página /control.

const SESSION_KEY = "cinefilo:tv-session";
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h

/** Extrae el session id de lo que sea que traiga el QR (URL o el id pelado). */
export function parseSession(raw: string): string | null {
  const s = raw.trim();
  try {
    const fromUrl = new URL(s).searchParams.get("session");
    if (fromUrl && /^[0-9a-f]{6,}$/i.test(fromUrl)) return fromUrl.toLowerCase();
  } catch {
    /* no es URL, seguimos */
  }
  const m = s.match(/[?&]session=([0-9a-f]{6,})/i);
  if (m) return m[1].toLowerCase();
  if (/^[0-9a-f]{6,}$/i.test(s)) return s.toLowerCase();
  return null;
}

export function saveSession(id: string): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch {
    /* noop */
  }
}

export function recentSession(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { id, ts } = JSON.parse(raw) as { id: string; ts: number };
    if (typeof id === "string" && Date.now() - ts < MAX_AGE_MS) return id;
  } catch {
    /* noop */
  }
  return null;
}

/**
 * Abre la cámara y escanea un QR. Devuelve el session id o null.
 * Import dinámico: el plugin es nativo — en el browser de desarrollo no existe,
 * y devolvemos null para que el caller ofrezca ingresar el código a mano.
 */
export async function scanTvQr(): Promise<string | null> {
  try {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    // Algunos dispositivos bajan el módulo del escáner de Google aparte.
    try {
      const avail = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!avail.available) await BarcodeScanner.installGoogleBarcodeScannerModule();
    } catch {
      /* scan() puede bajarlo igual */
    }
    const { barcodes } = await BarcodeScanner.scan();
    const raw = barcodes[0]?.rawValue ?? barcodes[0]?.displayValue;
    return raw ? parseSession(raw) : null;
  } catch (e) {
    console.warn("[tv-remote] escáner no disponible:", e);
    return null;
  }
}
