# Cinéfilo TV

App de Android TV / Google TV. Es el "receptáculo" de empaquetado (Capacitor +
config de Leanback/banner para Android TV) apuntando directo a la TV que ya
armó Carlos (`public/tv-lite.html`, servida por `server-node.mjs` en
producción) en vez de las pantallas propias de `src/` — ver `capacitor.config.ts`
(`server.url`). El control remoto es el teléfono: `apps/mobile` (o `/control`
web como fallback), mismo protocolo (`src/lib/tv-protocol.ts` de la raíz).

`src/` (App.tsx, screens/, hooks/) queda sin usarse mientras `server.url` esté
seteado — se conserva por si en algún momento se vuelve a un build propio
(sacar `server.url` de `capacitor.config.ts` y volver a `npm run build`).

## Build — primera vez

```powershell
cd C:\Users\<vos>\Documents\cinefilo\apps\tv
git pull origin dev
npm install --legacy-peer-deps
npm run build
npx cap add android
npx cap sync android
```

`npm run build` genera `dist/` — Capacitor lo exige para `cap sync` aunque no
se use en runtime (el WebView navega directo a `server.url`, no a `dist/index.html`).

`npx cap add android` genera la carpeta `android/` — **no está en git** (igual que
en `apps/mobile`), así que este paso se hace una sola vez, en tu máquina.

## Ediciones al AndroidManifest (obligatorias, una sola vez)

Abrí `android\app\src\main\AndroidManifest.xml` y hacé estos 4 cambios:

**1. Categoría de leanback** — dentro del `<intent-filter>` que ya tiene la
`<activity>` principal (junto a `MAIN`/`LAUNCHER`), agregá:
```xml
<category android:name="android.intent.category.LEANBACK_LAUNCHER"/>
```

**2. Banner** — en `<application ...>`, agregá el atributo:
```xml
android:banner="@drawable/tv_banner"
```
El archivo del banner (320×180) ya está generado en este repo, en
`apps/tv/res-tv/drawable/tv_banner.png`. Copialo a:
```
android\app\src\main\res\drawable\tv_banner.png
```
(Es un placeholder violeta con el logo — reemplazalo cuando tengan arte final.)

**3. Features opcionales** — como hijos directos de `<manifest>`:
```xml
<uses-feature android:name="android.software.leanback" android:required="false"/>
<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>
```

**4. Queries** (para que `@capacitor/app-launcher` pueda detectar/abrir las apps
de streaming — Android 11+ oculta qué apps están instaladas si no se declaran):
```xml
<queries>
    <package android:name="com.netflix.ninja" />
    <package android:name="com.amazon.amazonvideo.livingroom" />
    <package android:name="com.disney.disneyplus" />
    <package android:name="com.wbd.stream" />
    <package android:name="com.apple.atve.androidtv.appletv" />
    <package android:name="com.cbs.ott" />
</queries>
```

Si ya tenías un `<queries>` de otra app (no debería, `tv` es un proyecto nuevo),
fusioná los `<package>` en el mismo bloque en vez de duplicarlo.

## Variables de entorno

Con `server.url` apuntando a producción, `apps/tv/.env.example` ya no aplica
(esas variables solo las usa el build propio de `src/`, que hoy no se carga).
Si en algún momento se cambia la URL de producción, el único lugar a tocar es
`server.url` en `capacitor.config.ts`.

## Generar el APK

En Android Studio (`npx cap open android` o `npm run cap:android`):

1. **Build → Clean Project**
2. Si no tenés un emulador de TV: **Tools → Device Manager → Create Device →
   pestaña TV** → elegí uno de 1080p, API 34+
3. **Build → Generate App Bundles or APKs → Generate APKs**
4. El APK queda en `android\app\build\outputs\apk\debug\app-debug.apk`

Para reinstalar después de cambios de código (sin volver a tocar el manifest):
```powershell
npm run build
npx cap sync android
```
y repetís Clean Project + Generate APKs.

## Qué probar

- **Sin teléfono**: navegar `tv-lite.html` con las flechas del teclado
  (emulador) o el D-pad del control remoto — moveFocus/Enter ya están
  cableados (`keydown` en `public/tv-lite.html`, líneas ~599). Falta el
  mapeo del botón "Back" del control físico (hoy solo hay Back por UI).
- **Con teléfono**: abrir `apps/mobile`, escanear el QR que muestra la TV
  (`cinefilo:<session>` sobre Supabase Realtime) → debería emparejar
  ("Teléfono vinculado" en la TV). Buscar desde el teléfono cambia las
  cards en la TV; "Reproducir" dispara la reproducción.
- Confirmar que `https://cinefilo-production.up.railway.app/tv-lite.html`
  esté sirviendo la versión de `dev` (con lo de Carlos) antes de dar por
  buena una instalación — si el deploy de Railway quedó atrás, el APK carga
  una versión vieja de la pantalla aunque el APK en sí esté bien compilado.

## Estructura

```
capacitor.config.ts   # server.url → tv-lite.html en producción (el "contenido" real)
res-tv/                # banner Leanback (320×180) para el manifest

src/                   # SIN USAR mientras server.url esté seteado (ver arriba).
  App.tsx              # máquina de pantallas propia + estado
  screens/              # PairingScreen, PlatformsScreen, CardsScreen
  hooks/
    useDpad.ts, useTvSession.ts, use-tv-channel.ts
  lib/
    api.ts, posters.ts, context.ts, deeplink.ts, analytics.ts,
    justwatch.ts, tv-launcher.ts, tv-protocol.ts, media.ts,
    supabase.ts, tv-utils.ts
```

## Notas

- No se toca nada de lo que ya mergeó Carlos (`public/tv-lite.html`,
  `src/routes/control.tsx`, `src/lib/tv-protocol.ts` de la raíz, `tv-search.mjs`).
  El "receptáculo" (este proyecto) solo empaqueta esa pantalla para Android TV;
  la lógica de recomendaciones, búsqueda y backend es toda de Carlos.
- El control remoto es `apps/mobile`, ya construido para emparejar con este
  protocolo (mismo canal `cinefilo:<id>`, mismo proyecto Supabase, escanea el
  QR con cámara in-app vía `src/lib/tv-remote.ts`). No requiere cambios acá.
- Sin micrófono en la TV — la búsqueda por voz/texto se hace desde el teléfono.
