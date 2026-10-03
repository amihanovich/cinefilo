// Botón "atrás" del sistema (Android) y del navegador.
//
// Cómo funciona: Capacitor NO cierra la app si el WebView tiene historial —
// primero hace `history.back()`. Así que cada capa abierta (ficha, hoja, overlay,
// pantalla) empuja una entrada "guard" en el historial; el back del sistema la
// consume, dispara `popstate` y nosotros cerramos esa capa en vez de salir de la
// app. El mismo código arregla el back del navegador en la webapp, sin depender
// del plugin @capacitor/app.
//
// Regla: la capa que se abre última es la primera en cerrarse. Eso lo garantiza
// una PILA propia: antes cada capa escuchaba `popstate` por su cuenta, así que un
// "atrás" (o el history.back() con el que una capa cerrada desde la UI consume
// su guard) cerraba TODAS las capas abiertas a la vez — p. ej. cerrar "¿Dónde
// busco?" se llevaba puesto el modo voz que tenía abajo.

import { useEffect, useRef } from "react";

const GUARD = "miru:layer";

type Layer = { close: () => void; closedByBack: boolean };
const stack: Layer[] = [];
// history.back() que disparamos nosotros para consumir el guard de una capa
// cerrada desde la UI: su popstate no es un "atrás" del usuario.
let suppress = 0;
let listening = false;

function onPop(): void {
  if (suppress > 0) { suppress--; return; }
  const top = stack.pop();
  if (top) { top.closedByBack = true; top.close(); }
}

/**
 * Registra una capa cerrable mientras `active` sea true.
 * @param active si la capa está abierta
 * @param onBack qué hacer cuando el usuario aprieta atrás (cerrar esta capa)
 */
export function useBackLayer(active: boolean, onBack: () => void): void {
  // Ref para que cambiar el callback en cada render no re-registre la capa
  // (re-registrar empujaría entradas de historial de más).
  const cbRef = useRef(onBack);
  cbRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    try {
      window.history.pushState({ [GUARD]: true }, "");
    } catch {
      return; // sin History API: el back se comporta como antes
    }
    if (!listening) { window.addEventListener("popstate", onPop); listening = true; }
    const layer: Layer = { close: () => cbRef.current(), closedByBack: false };
    stack.push(layer);

    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      // Si la capa se cerró desde la UI (botón Volver, tap en el fondo…), su
      // guard sigue en el historial: lo consumimos —sin que nadie lo tome como
      // un "atrás"— para que el back del sistema no tenga que apretarse dos veces.
      if (!layer.closedByBack) {
        try {
          if (window.history.state && window.history.state[GUARD]) { suppress++; window.history.back(); }
        } catch { /* noop */ }
      }
    };
  }, [active]);
}
