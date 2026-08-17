#!/usr/bin/env node
// Publica un build (APK) de una app de Miru en Supabase Storage y actualiza
// el manifest.json que lee la landing. Se corre desde la terminal:
//
//   SUPABASE_URL=https://<proj>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   node scripts/publish-build.mjs --app=tv --version=1.2.0 ./miru-tv.apk
//
// Apps válidas: tv | mobile-android
//
// El service role key NO se commitea y NO se usa en el build de la landing:
// solo lo necesita este script para subir archivos (bypassa RLS del bucket).

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const VALID_APPS = ["tv", "mobile-android"];
const MANIFEST_PATH = "manifest.json";

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ── Parseo de argumentos ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const arg of args) {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  if (m) flags[m[1]] = m[2];
  else if (arg.startsWith("--")) flags[arg.slice(2)] = true;
  else positional.push(arg);
}

const app = flags.app;
const version = flags.version;
const filePath = positional[0];

if (!app || !VALID_APPS.includes(app)) {
  fail(`--app es obligatorio y debe ser uno de: ${VALID_APPS.join(", ")}`);
}
if (!version) fail("--version es obligatorio (ej: --version=1.2.0)");
if (!filePath) fail("Falta el path del archivo APK (último argumento)");
if (!fs.existsSync(filePath)) fail(`No existe el archivo: ${filePath}`);

// ── Config de Supabase ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.BUILDS_BUCKET || "app-builds";

if (!SUPABASE_URL) fail("Falta la variable de entorno SUPABASE_URL");
if (!SERVICE_KEY) fail("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Crea el bucket público si todavía no existe (idempotente). Así no hace falta
// aplicar la migración ni tocar el dashboard: el primer publish lo deja listo.
async function ensureBucket() {
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (data) {
    if (!data.public) {
      const { error: updErr } = await supabase.storage.updateBucket(BUCKET, { public: true });
      if (updErr) fail(`El bucket "${BUCKET}" existe pero es privado y no se pudo hacer público: ${updErr.message}`);
      console.log(`✓ Bucket "${BUCKET}" pasado a público.`);
    }
    return;
  }
  // getBucket falla si no existe → intentamos crearlo.
  const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (createErr) fail(`No se pudo crear el bucket "${BUCKET}": ${createErr.message}`);
  console.log(`✓ Bucket público "${BUCKET}" creado.`);
  void error;
}

// Lee manifest.json siempre en frío: pega directo al endpoint del objeto con
// `cache: "no-store"` y un query param único, para no recibir una copia vieja
// servida por el CDN (el objeto se sube con cache corto pero no nulo).
async function fetchManifestFresh() {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${MANIFEST_PATH}?t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 400) return { apps: {} };
  if (!res.ok) fail(`No se pudo leer el manifest: ${res.status} ${res.statusText}`);
  try {
    const manifest = await res.json();
    if (!manifest.apps) manifest.apps = {};
    return manifest;
  } catch {
    console.warn("⚠ manifest.json existente ilegible, se reescribe desde cero.");
    return { apps: {} };
  }
}

// Mergea `entry` bajo `manifest.apps[app]` con concurrencia optimista: lee en
// frío, escribe, y vuelve a leer para confirmar que las OTRAS apps del manifest
// no cambiaron mientras tanto (lo cual delataría un publish concurrente que
// pisamos, o que nos pisó a nosotros). Si detecta discrepancia, reintenta el
// merge completo desde una lectura fresca en vez de asumir que su copia sigue
// vigente.
async function updateManifest(app, entry) {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const manifest = await fetchManifestFresh();
    manifest.apps[app] = entry;
    manifest.updatedAt = new Date().toISOString();

    const { error: mErr } = await supabase.storage
      .from(BUCKET)
      .upload(MANIFEST_PATH, Buffer.from(JSON.stringify(manifest, null, 2)), {
        upsert: true,
        contentType: "application/json",
        cacheControl: "0",
      });
    if (mErr) fail(`No se pudo actualizar el manifest: ${mErr.message}`);

    const verify = await fetchManifestFresh();
    const otherAppsIntact = Object.keys(manifest.apps)
      .filter((k) => k !== app)
      .every((k) => JSON.stringify(verify.apps[k]) === JSON.stringify(manifest.apps[k]));
    const ownEntryWritten = JSON.stringify(verify.apps[app]) === JSON.stringify(manifest.apps[app]);

    if (otherAppsIntact && ownEntryWritten) return manifest;

    console.warn(`⚠ El manifest cambió durante la publicación, reintentando merge (${attempt}/${MAX_ATTEMPTS})…`);
    await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  fail("No se pudo actualizar manifest.json sin pisar otra publicación en curso tras varios intentos. Reintentá el publish.");
}

async function main() {
  const fileBuffer = fs.readFileSync(filePath);
  const size = fileBuffer.byteLength;
  const objectPath = `${app}/miru-${app}-${version}.apk`;

  // 0. Asegurar que el bucket público exista.
  await ensureBucket();

  // 1. Subir el APK (upsert para poder re-publicar la misma versión).
  console.log(`↑ Subiendo ${filePath} → ${BUCKET}/${objectPath} (${(size / 1048576).toFixed(1)} MB)…`);
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(objectPath, fileBuffer, {
    upsert: true,
    contentType: "application/vnd.android.package-archive",
  });
  if (upErr) fail(`No se pudo subir el APK: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  const publicUrl = pub.publicUrl;

  // 2-4. Mergear la entrada de esta app en el manifest y subirlo, con reintentos.
  // Publicar dos apps seguidas (ej: tv y mobile-android, uno atrás del otro) puede
  // pisar la escritura de la primera: cada corrida es un proceso CLI aparte que
  // hace read-modify-write sin lock, y el GET del manifest puede además devolver
  // una copia cacheada (el objeto se sube con cacheControl corto) en vez de la
  // recién escrita. `updateManifest` lee siempre en frío (bypassea cache) y,
  // después de subir, vuelve a leer para confirmar que nadie más escribió en el
  // medio; si detecta que se pisó algo reintenta el merge desde cero.
  const now = new Date().toISOString();
  await updateManifest(app, { version, url: publicUrl, size, updatedAt: now });

  console.log(`\n✓ Publicado ${app} v${version}`);
  console.log(`  Descarga: ${publicUrl}`);
  const { data: manPub } = supabase.storage.from(BUCKET).getPublicUrl(MANIFEST_PATH);
  console.log(`  Manifest: ${manPub.publicUrl}\n`);
}

main().catch((e) => fail(e?.message || String(e)));
