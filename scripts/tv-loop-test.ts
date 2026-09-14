/**
 * Verificación end-to-end del loop TV ↔ control sobre Supabase Realtime.
 * Usa los MISMOS schemas Zod del contrato y el MISMO mecanismo (broadcast +
 * presence) que `use-tv-channel.ts`, contra el proyecto Supabase real.
 *
 * Correr:  npx --yes tsx scripts/tv-loop-test.ts
 * (script de verificación, no forma parte del build)
 */
import { createClient } from "@supabase/supabase-js";
import {
  ControlCommand,
  TvState,
  type ControlCommandMessage,
  type TvStateMessage,
} from "../src/lib/tv-protocol";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) {
  console.error("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY en el entorno.");
  process.exit(2);
}

const CHANNEL = `cinefilo:looptest-${Date.now()}`;
const log = (...a: unknown[]) => console.log("•", ...a);
let failed = false;
const fail = (m: string) => {
  failed = true;
  console.error("✗", m);
};

async function main() {
  const tv = createClient(URL!, KEY!);
  const phone = createClient(URL!, KEY!);

  const tvChan = tv.channel(CHANNEL, {
    config: { broadcast: { self: false }, presence: { key: "tv" } },
  });
  const phoneChan = phone.channel(CHANNEL, {
    config: { broadcast: { self: false }, presence: { key: "control" } },
  });

  // --- Resultados esperados ---
  let receivedCommand: ControlCommandMessage | null = null;
  let receivedState: TvStateMessage | null = null;

  // TV escucha comandos del teléfono (valida con Zod, igual que el hook)
  tvChan.on("broadcast", { event: "command" }, ({ payload }) => {
    const parsed = ControlCommand.safeParse(payload);
    if (!parsed.success) return fail("Comando recibido NO valida contra ControlCommand");
    receivedCommand = parsed.data;
    log("TV recibió comando válido:", JSON.stringify(parsed.data));
  });

  // Teléfono escucha estado de la TV
  phoneChan.on("broadcast", { event: "state" }, ({ payload }) => {
    const parsed = TvState.safeParse(payload);
    if (!parsed.success) return fail("Estado recibido NO valida contra TvState");
    receivedState = parsed.data;
    log("Teléfono recibió estado válido:", JSON.stringify(parsed.data));
  });

  // El cliente Realtime sólo procesa los diffs de presence si hay un binding
  // de presence en el canal (igual que hace use-tv-channel.ts).
  tvChan.on("presence", { event: "sync" }, () => {});
  phoneChan.on("presence", { event: "sync" }, () => {});

  const peerPresent = (chan: typeof tvChan, key: string) =>
    Object.prototype.hasOwnProperty.call(chan.presenceState(), key);

  // --- Suscripción + presence (vinculación) ---
  await new Promise<void>((resolve, reject) => {
    let n = 0;
    const onSub = (s: string) => {
      if (s === "SUBSCRIBED" && ++n === 2) resolve();
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") reject(new Error(`subscribe: ${s}`));
    };
    tvChan.subscribe((s) => {
      if (s === "SUBSCRIBED") void tvChan.track({ role: "tv" });
      onSub(s);
    });
    phoneChan.subscribe((s) => {
      if (s === "SUBSCRIBED") void phoneChan.track({ role: "control" });
      onSub(s);
    });
    setTimeout(() => reject(new Error("timeout suscribiendo (10s)")), 10_000);
  });
  log("Ambos clientes SUBSCRIBED al canal", CHANNEL);

  // Esperamos a que presence propague (reintento hasta ~6s)
  let tvSawControl = false;
  let phoneSawTv = false;
  for (let i = 0; i < 12; i++) {
    await wait(500);
    tvSawControl = peerPresent(tvChan, "control");
    phoneSawTv = peerPresent(phoneChan, "tv");
    if (tvSawControl && phoneSawTv) break;
  }
  if (!tvSawControl) fail("La TV no detectó la presencia del control");
  if (!phoneSawTv) fail("El teléfono no detectó la presencia de la TV");
  if (tvSawControl && phoneSawTv) log("Vinculación (presence) OK en ambos sentidos");

  // --- Teléfono → TV: SEARCH ---
  const cmd: ControlCommandMessage = { type: "SEARCH", query: "algo de terror noventoso" };
  await phoneChan.send({ type: "broadcast", event: "command", payload: cmd });

  // --- TV → teléfono: SCREEN ---
  const state: TvStateMessage = {
    type: "SCREEN",
    screen: "search",
    focusedId: "m0",
    items: [
      { id: "m0", title: "Scream", year: 1996, platform: "Netflix" },
      { id: "m1", title: "El Resplandor", platform: "Max" },
    ],
  };
  await tvChan.send({ type: "broadcast", event: "state", payload: state });

  await wait(1500); // dejar viajar los broadcasts

  if (!receivedCommand) fail("La TV nunca recibió el comando SEARCH");
  else if (receivedCommand.type !== "SEARCH" || receivedCommand.query !== cmd.query)
    fail("El comando recibido no coincide con el enviado");

  if (!receivedState) fail("El teléfono nunca recibió el estado SCREEN");
  else if (receivedState.type !== "SCREEN" || receivedState.items.length !== 2)
    fail("El estado recibido no coincide con el enviado");

  await tv.removeAllChannels();
  await phone.removeAllChannels();

  if (failed) {
    console.error("\nRESULTADO: ✗ FALLÓ");
    process.exit(1);
  }
  console.log("\nRESULTADO: ✓ LOOP OK (presence + SEARCH→TV + SCREEN→teléfono, validados con Zod)");
  process.exit(0);
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("✗ Error fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
