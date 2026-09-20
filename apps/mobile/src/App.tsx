// Miru es, ante todo, una conversación: le pedís una buena película y te da UNA,
// bien justificada. Las capas que construimos alrededor (grilla de opciones,
// tops por plataforma, Mi lista, control de la TV) siguen enteras en el repo y
// se pueden abrir con ?full=1 — se irán sumando si la conversación tracciona.

import { ChatScreen } from "./screens/ChatScreen";
import WizardPage from "./wizard";

function wantsFullApp(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("full") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  return wantsFullApp() ? <WizardPage /> : <ChatScreen />;
}
