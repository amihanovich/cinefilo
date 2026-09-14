// Botón "atrás" del sistema (Android) y del navegador.
//
// Cómo funciona: Capacitor NO cierra la app si el WebView tiene historial —
// primero hace `history.back()`. Así que cada capa abierta (ficha, hoja, overlay,
// pantalla) empuja una entrada "guard" en el historial; el back del sistema la
// consume, dispara `popstate` y nosotros cerramos esa capa en vez de salir de la
// app. El mismo código arregla el back del navegador en la webapp, sin depender
// del plugin @capacitor/app.
//
// Regla: la capa que se abre última es la primera en cerrarse (el orden lo da el
// propio historial, no un stack nuestro).

import { useEffect, useRef } from "react";

const GUARD = "miru:layer";

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
    let closedByBack = false;

    try {
      window.history.pushState({ [GUARD]: true }, "");
    } catch {
      return; // sin History API: el back se comporta como antes
    }

    const onPop = () => {
      closedByBack = true;
      cbRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Si la capa se cerró desde la UI (botón Volver, tap en el fondo…), el
      // guard sigue en el historial: lo consumimos para que el back del sistema
      // no tenga que apretarse dos veces.
      if (!closedByBack) {
        try {
          if (window.history.state && window.history.state[GUARD]) window.history.back();
        } catch { /* noop */ }
      }
    };
  }, [active]);
}
