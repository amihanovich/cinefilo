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

  // 2. Leer el manifest actual (si existe).
  let manifest = { apps: {} };
  const { data: existing, error: dlErr } = await supabase.storage.from(BUCKET).download(MANIFEST_PATH);
  if (existing) {
    try {
      manifest = JSON.parse(await existing.text());
      if (!manifest.apps) manifest.apps = {};
    } catch {
      console.warn("⚠ manifest.json existente ilegible, se reescribe desde cero.");
      manifest = { apps: {} };
    }
  } else if (dlErr && !/not.?found|does not exist|400|404/i.test(dlErr.message)) {
    fail(`No se pudo leer el manifest: ${dlErr.message}`);
  }

  // 3. Actualizar la entrada de esta app.
  const now = new Date().toISOString();
  manifest.apps[app] = { version, url: publicUrl, size, updatedAt: now };
  manifest.updatedAt = now;

  // 4. Volver a subir el manifest (cache corto para que la landing lo repunte).
  const { error: mErr } = await supabase.storage
    .from(BUCKET)
    .upload(MANIFEST_PATH, Buffer.from(JSON.stringify(manifest, null, 2)), {
      upsert: true,
      contentType: "application/json",
      cacheControl: "60",
    });
  if (mErr) fail(`No se pudo actualizar el manifest: ${mErr.message}`);

  console.log(`\n✓ Publicado ${app} v${version}`);
  console.log(`  Descarga: ${publicUrl}`);
  const { data: manPub } = supabase.storage.from(BUCKET).getPublicUrl(MANIFEST_PATH);
  console.log(`  Manifest: ${manPub.publicUrl}\n`);
}

main().catch((e) => fail(e?.message || String(e)));
