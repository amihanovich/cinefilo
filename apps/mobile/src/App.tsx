// Miru es, ante todo, una conversación: le pedís una buena película y te da UNA,
// bien justificada. Las capas que construimos alrededor (grilla de opciones,
// tops por plataforma, Mi lista, control de la TV) siguen enteras en el repo y
// se pueden abrir con ?full=1 — se irán sumando si la conversación tracciona.
// /privacidad y /terminos son las páginas legales (las pide Google para el login).

import { ChatScreen } from "./screens/ChatScreen";
import { PrivacyPage, TermsPage } from "./screens/LegalScreen";
import WizardPage from "./wizard";

function wantsFullApp(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("full") === "1";
  } catch {
    return false;
  }
}

const full = wantsFullApp();
const path = (() => { try { return window.location.pathname.replace(/\/+$/, "") || "/"; } catch { return "/"; } })();

// El tema va en <html> y no en un div: el body pinta el fondo, así que el rebote
// del scroll y las safe areas mostrarían el otro tema por detrás. La conversación
// es PAPEL (texto largo, una ficha); la app de pósters sigue oscura.
try {
  document.documentElement.classList.add(full ? "theme-dark" : "theme-paper");
} catch { /* noop */ }

export default function App() {
  if (path === "/privacidad") return <PrivacyPage />;
  if (path === "/terminos") return <TermsPage />;
  return full ? <WizardPage /> : <ChatScreen />;
}
