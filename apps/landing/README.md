# Cinéfilo Landing

Landing simple con la estética de Cinéfilo para descargar las apps (TV y celular)
y abrir el control remoto. Pensada para mandarle el link a friends & family: cada
uno entra, ve la última versión de cada app y la baja por botón directo o QR.

Es una SPA estática (Vite + React + Tailwind, mismo stack que `apps/web-control`).
Se despliega como **servicio Railway propio** y lee un `manifest.json` de builds
que vive en **Supabase Storage**. No tiene backend propio.

## Cómo funciona

```
Terminal ──publish-build.mjs──▶ Supabase Storage (bucket público "app-builds")
                                   ├─ tv/cinefilo-tv-<ver>.apk
                                   ├─ mobile-android/cinefilo-mobile-android-<ver>.apk
                                   └─ manifest.json
                                        │  (URL pública)
                                        ▼
                                 apps/landing (Railway) ──fetch──▶ tarjetas + QR
```

## Desarrollo

```bash
cd apps/landing
npm install --legacy-peer-deps
cp .env.example .env.local   # completá VITE_MANIFEST_URL y VITE_WEB_CONTROL_URL
npm run dev                  # http://localhost:5173
```

## Build + servir

```bash
npm run build   # genera dist/
npm start       # sirve dist/ con server.mjs (SPA fallback) en $PORT
```

## Publicar una versión nueva de una app

1. Generá el APK (ver `apps/tv/README.md` para la app de TV y
   `apps/mobile/README.md` para la de celular).
2. Corré el script con el service role key de Supabase:

```bash
SUPABASE_URL=https://<proj>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run publish -- --app=tv --version=1.2.0 ./cinefilo-tv.apk
```

`--app` puede ser `tv` o `mobile-android`. El script sube el APK, actualiza el
`manifest.json` y te imprime el link público de descarga. La landing lo repunta
solo (sin redeploy).

## Setup inicial de Supabase

**No hace falta ningún paso manual:** la primera vez que corrés `npm run publish`,
el script crea el bucket público `app-builds` si no existe (usa el service role
key). Los buckets públicos permiten descarga anónima; la subida la hace el
service role.

Si preferís crearlo aparte, están la migración
`supabase/migrations/20260705000000_app_builds_bucket.sql` o el dashboard de
Supabase (bucket **público** llamado `app-builds`).

## Deploy en Railway (servicio aparte)

1. New Project → Deploy from repo → elegí este repo.
2. **Settings → Root Directory** del servicio: `apps/landing`. Railway toma el
   `nixpacks.toml` + `railway.json` de esta carpeta (build `npm run build`,
   start `node server.mjs`).
3. **Settings → Networking → Custom Domain**: configurá el dominio propio.
4. **Variables** del servicio:
   - `VITE_MANIFEST_URL` — URL pública del `manifest.json` en Supabase Storage.
   - `VITE_WEB_CONTROL_URL` — URL del servicio web-control (opcional; sin ella no
     aparece la tarjeta de control remoto).

## Notas

- iOS queda como "Próximamente": un `.ipa` no se instala por descarga directa
  (necesita TestFlight o distribución ad-hoc). Cuando haya TestFlight se puede
  sumar como una tarjeta con link.
- No se commitean binarios ni el service role key.
