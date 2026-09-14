#!/usr/bin/env node
// Prueba de concepto: manejar la TV desde afuera con el protocolo Android TV
// Remote v2 (el mismo que usa la app "Google TV" del celular).
//
// QUÉ QUEREMOS SABER (antes de invertir en un plugin nativo para la app móvil):
//   1. ¿Podemos parear con la TV de casa y mandarle órdenes?
//   2. ¿Podemos abrir un título EXACTO en Netflix/Prime/Disney+ desde afuera,
//      aunque la TV no tenga Miru instalado?
//   3. ¿El deep link sobrevive al muro de perfiles, o queda esperando ahí?
//   4. ¿El deeplink que da JustWatch para ANDROID_TV es mejor que el de WEB?
//
// Corre en Node (la PC tiene que estar en la MISMA red que la TV). No toca el
// producto: es un script aparte, nada de esto se deploya.
//
//   npm install                              (una vez, en esta carpeta)
//   node poc.mjs pair 192.168.0.42           (una vez: PIN en la pantalla)
//   node poc.mjs links "Mad Max Fury Road"   (sin tocar la TV: ver los links)
//   node poc.mjs open 192.168.0.42 "Mad Max Fury Road"
//   node poc.mjs watch 192.168.0.42          (qué app está abierta, en vivo)

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createAndroidRemote, RemoteKeyCode } from "@kud/androidtv-remote";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CERT_FILE = path.join(DIR, "cert.json"); // credencial del pairing (NO se commitea)
const COUNTRY = process.env.MIRU_COUNTRY || "AR";

// ── JustWatch: los mismos deeplinks que usa la app ──────────────────────────
// (copia del query de apps/mobile/src/lib/justwatch.ts; acá pedimos además la
// variante ANDROID_TV, que la app no consulta — parte de lo que queremos saber)
const JW_ENDPOINT = "https://apis.justwatch.com/graphql";
const JW_QUERY = `
query GetTitleOffers($searchQuery: String!, $country: Country!, $language: Language!, $objectTypes: [ObjectType!], $platform: Platform!) {
  popularTitles(country: $country, first: 5, filter: { searchQuery: $searchQuery, objectTypes: $objectTypes }) {
    edges { node {
      objectType
      ... on Movie { content(country: $country, language: $language) { title originalReleaseYear }
        offers(country: $country, platform: $platform) { monetizationType standardWebURL deeplinkAndroid package { technicalName clearName } } }
      ... on Show { content(country: $country, language: $language) { title originalReleaseYear }
        offers(country: $country, platform: $platform) { monetizationType standardWebURL deeplinkAndroid package { technicalName clearName } } }
    } }
  }
}`;

async function jwOffers(title, { type = "MOVIE", platform = "WEB" } = {}) {
  const res = await fetch(JW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "App-Version": "3.8.2" },
    body: JSON.stringify({
      query: JW_QUERY,
      variables: { searchQuery: title, country: COUNTRY, language: "es", objectTypes: [type], platform },
    }),
  });
  if (!res.ok) throw new Error("JustWatch HTTP " + res.status);
  const data = await res.json();
  const edges = data?.data?.popularTitles?.edges || [];
  const node = edges[0]?.node;
  if (!node) return null;
  const offers = (node.offers || []).filter((o) => o.monetizationType === "FLATRATE");
  return { title: node.content?.title, year: node.content?.originalReleaseYear, offers };
}

// ── Conexión con la TV ──────────────────────────────────────────────────────
function loadCert() {
  try { return JSON.parse(fs.readFileSync(CERT_FILE, "utf8")); } catch { return undefined; }
}
function saveCert(cert) {
  fs.writeFileSync(CERT_FILE, JSON.stringify(cert, null, 2));
  console.log("🔐 credencial guardada en", CERT_FILE, "(no la subas al repo)");
}
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(question, (a) => { rl.close(); r(a.trim()); }));
}

/** Conecta (pareando si hace falta) y resuelve cuando la TV está lista. */
async function connect(host, { allowPair = true } = {}) {
  const cert = loadCert();
  if (!cert && !allowPair) {
    console.error("✗ No hay credencial. Corré primero:  node poc.mjs pair " + host);
    process.exit(1);
  }
  const remote = createAndroidRemote(host, {
    cert,
    // Lo que la TV muestra como "dispositivo que se conecta".
    service_name: "Miru", manufacturer: "Miru", model: "Miru control",
  });

  remote.on("secret", async () => {
    console.log("\n📺 Mirá la TV: tiene que estar mostrando un código de 6 caracteres.");
    const code = await ask("   Escribilo acá y dale Enter: ");
    remote.sendCode(code);
  });
  remote.on("error", (e) => console.error("✗ error:", e?.message || e));
  remote.on("unpaired", () => console.error("✗ la TV rechazó el pairing (código mal escrito o expirado)"));
  remote.on("current_app", (app) => console.log("   📱 app en pantalla:", app));
  remote.on("powered", (on) => console.log("   ⏻  TV encendida:", on));

  const ready = new Promise((resolve, reject) => {
    remote.once("ready", resolve);
    setTimeout(() => reject(new Error("la TV no respondió en 60 s")), 60000);
  });
  await remote.start();
  await ready;
  const fresh = remote.getCertificate();
  if (fresh && (!cert || fresh.cert !== cert.cert)) saveCert(fresh);
  console.log("✓ conectado a la TV\n");
  return remote;
}

// ── Comandos ────────────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);

function printOffers(label, r) {
  if (!r) { console.log(`  ${label}: sin resultados`); return; }
  console.log(`  ${label} → "${r.title}" (${r.year || "s/d"})`);
  if (!r.offers.length) console.log("     (sin ofertas de suscripción)");
  for (const o of r.offers) {
    console.log(`     · ${o.package.clearName.padEnd(14)} deeplinkAndroid: ${o.deeplinkAndroid || "—"}`);
    console.log(`       ${" ".repeat(14)} web:             ${o.standardWebURL || "—"}`);
  }
}

async function cmdLinks() {
  const title = args[0];
  if (!title) return console.error('uso: node poc.mjs links "Título" [serie]');
  const type = /serie/i.test(args[1] || "") ? "SHOW" : "MOVIE";
  console.log(`\n🔎 "${title}" (${type === "SHOW" ? "serie" : "película"}, país ${COUNTRY})\n`);
  // La app pide WEB; acá comparamos con ANDROID_TV, que es lo que corre en la tele.
  for (const platform of ["WEB", "ANDROID_TV"]) {
    try { printOffers(platform.padEnd(10), await jwOffers(title, { type, platform })); }
    catch (e) { console.log(`  ${platform}: ✗ ${e.message}`); }
    console.log("");
  }
}

async function cmdPair() {
  const host = args[0];
  if (!host) return console.error("uso: node poc.mjs pair <ip-de-la-tv>");
  if (fs.existsSync(CERT_FILE)) console.log("ℹ ya hay una credencial; borrá cert.json si querés parear de cero.\n");
  const remote = await connect(host);
  console.log("Listo. Probá:  node poc.mjs open " + host + ' "Mad Max Fury Road"');
  remote.stop();
}

async function cmdOpen() {
  const [host, title, kind] = args;
  if (!host || !title) return console.error('uso: node poc.mjs open <ip> "Título" [serie]');
  const type = /serie/i.test(kind || "") ? "SHOW" : "MOVIE";
  console.log(`\n🔎 buscando "${title}" en JustWatch (${COUNTRY})…`);
  let tv = null, web = null, netErr = null;
  try { tv = await jwOffers(title, { type, platform: "ANDROID_TV" }); } catch (e) { netErr = e; }
  try { web = await jwOffers(title, { type, platform: "WEB" }); } catch (e) { netErr = netErr || e; }
  // Un fallo de red y un "no hay oferta" son cosas distintas: no confundirlos.
  if (!tv && !web) {
    console.log(netErr ? "✗ no pude consultar JustWatch: " + netErr.message : "✗ JustWatch no encontró ese título.");
    return;
  }
  const pick = (tv?.offers || []).find((o) => o.deeplinkAndroid) || (web?.offers || []).find((o) => o.deeplinkAndroid);
  if (!pick) { console.log("✗ el título está, pero sin deeplink de suscripción en " + COUNTRY + "."); return; }
  console.log(`✓ ${pick.package.clearName}: ${pick.deeplinkAndroid}\n`);

  const remote = await connect(host, { allowPair: false });
  console.log("→ mandando el link a la TV…");
  remote.sendAppLink(pick.deeplinkAndroid);
  console.log(`
   MIRÁ LA TV y anotá qué pasó:
     a) abrió la app Y el título exacto (ficha o reproduciendo)
     b) abrió la app pero quedó en el selector de PERFILES
     c) abrió la app en su home, sin el título
     d) no pasó nada
   (dejo la conexión abierta 30 s para ver qué app queda en pantalla)`);
  setTimeout(() => { remote.stop(); process.exit(0); }, 30000);
}

async function cmdLink() {
  const [host, url] = args;
  if (!host || !url) return console.error('uso: node poc.mjs link <ip> "nflx://..."');
  const remote = await connect(host, { allowPair: false });
  console.log("→ mandando:", url);
  remote.sendAppLink(url);
  setTimeout(() => { remote.stop(); process.exit(0); }, 20000);
}

async function cmdKey() {
  const [host, key] = args;
  if (!host || !key) {
    console.error('uso: node poc.mjs key <ip> KEYCODE_DPAD_CENTER');
    console.error("teclas útiles: KEYCODE_DPAD_UP/DOWN/LEFT/RIGHT, KEYCODE_DPAD_CENTER, KEYCODE_BACK, KEYCODE_HOME");
    return;
  }
  const code = RemoteKeyCode[key];
  if (code === undefined) return console.error("✗ tecla desconocida:", key);
  const remote = await connect(host, { allowPair: false });
  console.log("→", key);
  remote.sendKey(code);
  setTimeout(() => { remote.stop(); process.exit(0); }, 3000);
}

async function cmdWatch() {
  const host = args[0];
  if (!host) return console.error("uso: node poc.mjs watch <ip>");
  await connect(host, { allowPair: false });
  console.log("Mirando qué app está en pantalla. Ctrl+C para salir.\n");
}

const COMMANDS = { pair: cmdPair, open: cmdOpen, link: cmdLink, key: cmdKey, watch: cmdWatch, links: cmdLinks };
const run = COMMANDS[cmd];
if (!run) {
  console.log(`
Miru · prueba de control de la TV desde afuera

  node poc.mjs pair  <ip>                      parear (PIN en la pantalla de la TV)
  node poc.mjs links "Título" [serie]           ver los deeplinks (no toca la TV)
  node poc.mjs open  <ip> "Título" [serie]      abrir ese título en la TV
  node poc.mjs link  <ip> "nflx://..."          mandar un link a mano
  node poc.mjs key   <ip> KEYCODE_DPAD_CENTER   mandar una tecla
  node poc.mjs watch <ip>                       ver qué app está abierta

La IP de la TV está en Ajustes → Red. La PC tiene que estar en la misma red.`);
  process.exit(1);
}
run().catch((e) => { console.error("\n✗", e?.message || e); process.exit(1); });
