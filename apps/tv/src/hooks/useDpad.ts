// Navegación con control remoto físico de la TV (D-pad) por zonas.
//
// Modelo: una lista de FILAS, cada una con N columnas. El foco es {fila, col}.
//   ←/→  mueven la columna dentro de la fila
//   ↑/↓  cambian de fila (saltando filas vacías), preservando la columna
//   OK   dispara onSelect(filaId, col)
//   Back dispara onBack (o sale de la app si no hay onBack — pantalla raíz)
//
// La MISMA API (move/select/setFocus) la usa también el teléfono como control:
// App reenvía los comandos NAVIGATE/FOCUS/SELECT a esta instancia vía un bridge,
// así el remoto físico y el teléfono comparten un único camino de código.

import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";

export type Direction = "up" | "down" | "left" | "right";

export interface DpadRow {
  id: string;
  count: number;
}

export interface DpadApi {
  isFocused: (rowId: string, col: number) => boolean;
  focusedRowId: string | null;
  focusedCol: number;
  move: (dir: Direction) => void;
  select: () => void;
  setFocus: (rowId: string, col: number) => void;
}

// Lo que App necesita para reenviar comandos del teléfono a la pantalla activa.
export interface DpadBridge {
  move: (dir: Direction) => void;
  select: () => void;
  setFocus: (rowId: string, col: number) => void;
  /** Foco por id de ítem — solo la pantalla que conoce su layout puede mapearlo
   *  (p. ej. HomeScreen con rails). Opcional: CardsScreen no lo provee. */
  focusById?: (id: string) => void;
}

interface Options {
  rows: DpadRow[];
  onSelect: (rowId: string, col: number) => void;
  onBack?: () => void;
  onFocusChange?: (rowId: string, col: number) => void;
  /** Cuando es false, ignora las teclas (p. ej. mientras carga). */
  enabled?: boolean;
  /** Cada fila recuerda su columna: al bajar/subir aterrizás donde estabas en
   *  esa fila (estilo Netflix), no en la columna global. */
  rememberColumns?: boolean;
}

type Pos = { row: number; col: number };

export function useDpad({ rows, onSelect, onBack, onFocusChange, enabled = true, rememberColumns = false }: Options): DpadApi {
  const [pos, setPos] = useState<Pos>({ row: 0, col: 0 });

  // Refs para que el listener de teclado (montado una sola vez) lea siempre lo
  // último sin re-suscribirse.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const rememberColumnsRef = useRef(rememberColumns);
  rememberColumnsRef.current = rememberColumns;
  const posRef = useRef(pos);
  // Columna recordada por fila (id → col), para la navegación estilo rails.
  const colsByRowRef = useRef<Record<string, number>>({});

  const applyFocus = useCallback((row: number, col: number, notify = true) => {
    posRef.current = { row, col };
    setPos({ row, col });
    const r = rowsRef.current[row];
    if (r) colsByRowRef.current[r.id] = col;
    if (notify && r) onFocusChangeRef.current?.(r.id, col);
  }, []);

  const move = useCallback(
    (dir: Direction) => {
      const rowsNow = rowsRef.current;
      if (rowsNow.length === 0) return;
      let { row, col } = posRef.current;
      if (row >= rowsNow.length) row = rowsNow.length - 1;

      if (dir === "left") {
        col = Math.max(0, col - 1);
      } else if (dir === "right") {
        col = Math.min((rowsNow[row]?.count ?? 1) - 1, col + 1);
      } else {
        const step = dir === "up" ? -1 : 1;
        let r = row + step;
        while (r >= 0 && r < rowsNow.length && rowsNow[r].count === 0) r += step;
        if (r >= 0 && r < rowsNow.length) {
          row = r;
          // Con rememberColumns, aterrizás en la columna recordada de esa fila;
          // sino, preservás la columna global (comportamiento original).
          const target = rememberColumnsRef.current
            ? (colsByRowRef.current[rowsNow[r].id] ?? 0)
            : col;
          col = Math.min(target, rowsNow[r].count - 1);
        }
      }

      if (row !== posRef.current.row || col !== posRef.current.col) applyFocus(row, col);
    },
    [applyFocus],
  );

  const select = useCallback(() => {
    const { row, col } = posRef.current;
    const r = rowsRef.current[row];
    if (r && r.count > 0) onSelectRef.current(r.id, col);
  }, []);

  const setFocus = useCallback(
    (rowId: string, col: number) => {
      const idx = rowsRef.current.findIndex((r) => r.id === rowId);
      if (idx < 0) return;
      const clampedCol = Math.max(0, Math.min(col, rowsRef.current[idx].count - 1));
      applyFocus(idx, clampedCol);
    },
    [applyFocus],
  );

  // Clamp: al cambiar las filas (nuevo deck, overlay abierto/cerrado) mantener el
  // foco en una posición válida y no vacía.
  const sig = rows.map((r) => `${r.id}:${r.count}`).join("|");
  useEffect(() => {
    const rowsNow = rowsRef.current;
    if (rowsNow.length === 0) return;
    let { row, col } = posRef.current;
    if (row >= rowsNow.length) row = rowsNow.length - 1;
    if (rowsNow[row].count === 0) {
      const firstValid = rowsNow.findIndex((r) => r.count > 0);
      row = firstValid >= 0 ? firstValid : 0;
    }
    col = Math.max(0, Math.min(col, (rowsNow[row].count || 1) - 1));
    if (row !== posRef.current.row || col !== posRef.current.col) applyFocus(row, col, false);
  }, [sig, applyFocus]);

  // Teclado del control remoto físico.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      switch (e.keyCode) {
        case 37: e.preventDefault(); move("left"); break;
        case 38: e.preventDefault(); move("up"); break;
        case 39: e.preventDefault(); move("right"); break;
        case 40: e.preventDefault(); move("down"); break;
        case 13: // Enter
        case 23: // KEYCODE_DPAD_CENTER (algunos remotos)
          e.preventDefault();
          select();
          break;
        case 27: // Escape
        case 8: // Backspace
        case 461: // Back (LG webOS)
        case 10009: // Back (Samsung Tizen)
          e.preventDefault();
          onBackRef.current?.();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [move, select]);

  // Botón "atrás" físico de Android TV — la señal confiable es la del plugin App.
  useEffect(() => {
    let remove: (() => void) | undefined;
    void CapacitorApp.addListener("backButton", () => {
      if (!enabledRef.current) return;
      if (onBackRef.current) onBackRef.current();
      else void CapacitorApp.exitApp();
    }).then((h) => {
      remove = () => h.remove();
    });
    return () => remove?.();
  }, []);

  const focusedRow = rows[pos.row];
  return {
    isFocused: (rowId, col) => focusedRow?.id === rowId && pos.col === col,
    focusedRowId: focusedRow?.id ?? null,
    focusedCol: pos.col,
    move,
    select,
    setFocus,
  };
}
