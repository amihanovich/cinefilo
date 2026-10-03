// La memoria del videoclub, en la cuenta. La app sigue trabajando contra el
// localStorage (rápido, sin red en el camino crítico) y este módulo lo mantiene
// sincronizado con la fila del usuario en Supabase (tabla miru_taste, RLS: cada
// uno solo ve la suya). Así Miru te conoce en cualquier dispositivo.
//
//   - Al entrar: se baja la memoria de la cuenta y se FUSIONA con la local. Lo
//     que hiciste sin cuenta (las recomendaciones de prueba) pasa a tu cuenta.
//     Si el teléfono tenía la memoria de OTRA cuenta, no se mezclan: manda la tuya.
//   - Mientras usás Miru: cada cambio local se sube solo, con un pequeño retraso.
//   - Al salir: el teléfono queda limpio para el próximo.
// Si la tabla todavía no existe o no hay red, todo sigue andando local.

import { authClient } from "./auth";
import { loadTaste, replaceTaste, clearTaste, TASTE_CHANGED, type TasteStore } from "./taste";
import { loadOpened, replaceOpened, clearOpened, type OpenedItem } from "./opened";
import { loadPlatforms, savePlatforms, PLATFORMS_KEY } from "./prefs";

const OWNER_KEY = "miru:taste-owner";
const PUSH_DELAY_MS = 2500;

type Row = { data: Partial<TasteStore> | null; opened: OpenedItem[] | null; platforms: string[] | null };

const tsOf = (x: { ts?: string }) => x.ts ?? "";

// Unión de dos listas de señales sin duplicar (misma clave = misma señal), en
// orden cronológico y con el mismo tope que usa taste.ts.
function unionBy<T>(a: T[] = [], b: T[] = [], key: (x: T) => string, order: (x: T) => string, cap: number): T[] {
  const seen = new Map<string, T>();
  for (const x of [...a, ...b]) seen.set(key(x), x);
  return [...seen.values()].sort((x, y) => order(x).localeCompare(order(y))).slice(-cap);
}

export function mergeTaste(local: TasteStore, remote: Partial<TasteStore> | null): TasteStore {
  if (!remote) return local;
  const r = { ...local, ...remote } as TasteStore;
  // Veredictos: uno por título y etapa; gana el más nuevo.
  const verdicts = new Map<string, TasteStore["verdicts"][number]>();
  for (const v of [...(remote.verdicts ?? []), ...local.verdicts]) {
    const k = `${v.title}|${v.stage}`;
    const prev = verdicts.get(k);
    if (!prev || tsOf(v) > tsOf(prev)) verdicts.set(k, v);
  }
  const lp = local.profile, rp = remote.profile ?? null;
  return {
    requests: unionBy(remote.requests, local.requests, (x) => `${x.ts}|${x.q}`, tsOf, 30),
    rejected: unionBy(remote.rejected, local.rejected, (x) => `${x.ts}|${x.title}`, tsOf, 40),
    verdicts: [...verdicts.values()].sort((x, y) => tsOf(x).localeCompare(tsOf(y))).slice(-40),
    shown: unionBy(remote.shown, local.shown, (x) => x.title, tsOf, 80),
    sessions: [...new Set([...(remote.sessions ?? []), ...local.sessions])].sort().slice(-60),
    profile: !lp ? rp : !rp ? lp : (lp.updatedAt > rp.updatedAt ? lp : rp),
    pending: Math.max(local.pending ?? 0, remote.pending ?? 0),
    askedAbout: local.askedAbout ?? r.askedAbout ?? null,
    notes: unionBy(remote.notes, local.notes, (x) => x.id, tsOf, 30),
    // La pausa es una preferencia de la cuenta: si en algún lado la pausaste, sigue pausada.
    memoryOff: !!(local.memoryOff || remote.memoryOff),
    removedTags: [...new Set([...(remote.removedTags ?? []), ...(local.removedTags ?? [])])],
  };
}

export function mergeOpened(local: OpenedItem[], remote: OpenedItem[] | null): OpenedItem[] {
  const by = new Map<string, OpenedItem>();
  for (const o of [...(remote ?? []), ...local]) {
    const k = `${o.title}|${o.platform}`;
    const prev = by.get(k);
    if (!prev || o.openedAt > prev.openedAt) by.set(k, o);
  }
  return [...by.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 30);
}

let currentUser: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let warned = false;

async function push(): Promise<void> {
  const uid = currentUser;
  if (!uid) return;
  const platforms = (() => { try { return localStorage.getItem(PLATFORMS_KEY) ? loadPlatforms() : []; } catch { return []; } })();
  const { error } = await authClient.from("miru_taste").upsert({
    user_id: uid,
    data: loadTaste(),
    opened: loadOpened(),
    platforms,
    updated_at: new Date().toISOString(),
  });
  if (error && !warned) { warned = true; console.warn("[taste-sync] no pude guardar en la cuenta (¿falta la migración miru_taste?):", error.message); }
}

function schedulePush(): void {
  if (!currentUser) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; void push(); }, PUSH_DELAY_MS);
}

/**
 * Engancha la memoria a la cuenta que acaba de entrar. Devuelve true si bajó
 * algo de la cuenta (para refrescar la pantalla).
 */
export async function startTasteSync(userId: string): Promise<boolean> {
  if (currentUser === userId) return false;
  currentUser = userId;
  window.addEventListener(TASTE_CHANGED, schedulePush);

  let owner: string | null = null;
  try { owner = localStorage.getItem(OWNER_KEY); } catch { /* noop */ }
  // El teléfono tenía la memoria de OTRA cuenta: no se mezcla, se empieza de la tuya.
  if (owner && owner !== userId) { clearTaste(); clearOpened(); }

  let row: Row | null = null;
  try {
    const { data, error } = await authClient.from("miru_taste").select("data, opened, platforms").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    row = (data as Row | null) ?? null;
  } catch (e) {
    if (!warned) { warned = true; console.warn("[taste-sync] no pude leer la memoria de la cuenta:", (e as Error).message); }
  }

  if (row) {
    replaceTaste(mergeTaste(loadTaste(), row.data));
    replaceOpened(mergeOpened(loadOpened(), row.opened));
    if (row.platforms && row.platforms.length) savePlatforms(row.platforms);
  }
  try { localStorage.setItem(OWNER_KEY, userId); } catch { /* noop */ }
  void push(); // lo fusionado (incluido lo que hiciste sin cuenta) queda en la cuenta
  return !!row;
}

/**
 * Al cerrar sesión: se sube lo último y el teléfono queda limpio.
 * Con `upload: false` (la cuenta se acaba de borrar) no se sube nada.
 */
export async function stopTasteSync(upload = true): Promise<void> {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (currentUser && upload) await push().catch(() => undefined);
  currentUser = null;
  window.removeEventListener(TASTE_CHANGED, schedulePush);
  clearTaste();
  clearOpened();
  try { localStorage.removeItem(OWNER_KEY); } catch { /* noop */ }
}
