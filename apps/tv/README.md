# Miru — app de TV

App de Android TV / Google TV. Mismo motor de recomendaciones que `apps/mobile`,
adaptada a pantalla grande + control remoto (D-pad) + el teléfono como control
opcional (protocolo compartido con `/control`, ver `src/lib/tv-protocol.ts`).

## Build — primera vez

```powershell
cd C:\Users\<vos>\Documents\cinefilo\apps\tv
git pull origin dev
npm install --legacy-peer-deps
npm run build
npx cap add android
npx cap sync android
```

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

## Variables de entorno (opcional)

`apps/tv/.env.example` documenta las variables. Si no creás un `.env.local`,
la app usa defaults hardcodeados que **ya funcionan** (las mismas credenciales
públicas de Supabase que usa `public/tv-lite.html`) — no es obligatorio
configurar nada para probar.

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

- **Sin teléfono**: navegar todo con las flechas del teclado (emulador) o el
  D-pad del control remoto — plataformas, cards, alternativas, "Ver ahora",
  Back en cada pantalla.
- **Con teléfono**: escanear el QR de la pantalla de pairing → abre `/control`
  en el navegador del celular → debería emparejar (aparece "Teléfono
  conectado" en la TV). Buscar desde el teléfono cambia las cards en la TV;
  deslizar la lista del teléfono mueve el foco en la TV; "Reproducir" desde el
  teléfono dispara "Ver ahora".
- **"Ver ahora" en dispositivo real** (el emulador no tiene apps de streaming
  instaladas): confirmar que abre la app nativa y no se queda en un mensaje
  manual. Los packages de Paramount+ y Apple TV+ están marcados como de menor
  confianza en `src/lib/tv-launcher.ts` — si fallan, avisar para ajustar el
  package correcto.

## Estructura

```
src/
  App.tsx              # máquina de pantallas + estado + integra todo
  screens/              # PairingScreen, PlatformsScreen, CardsScreen
  hooks/
    useDpad.ts          # navegación D-pad por zonas (control físico)
    useTvSession.ts      # sesión + protocolo del teléfono (lado TV)
    use-tv-channel.ts    # canal Supabase Realtime (adaptado de la raíz)
  lib/
    api.ts, posters.ts, context.ts   # copiados de apps/mobile (mantener en sync a mano)
    deeplink.ts, analytics.ts         # adaptados de apps/mobile
    justwatch.ts                      # jwSearch (búsqueda de disponibilidad)
    tv-launcher.ts                    # "Ver ahora" con packages de Android TV
    tv-protocol.ts                    # copiado verbatim de la raíz (contrato con /control)
    media.ts                          # DeckItem ↔ MediaItem (puente con el protocolo)
    supabase.ts, tv-utils.ts
```

## Notas

- No se toca nada de lo que ya mergeó Carlos (`public/tv-lite.html`,
  `src/routes/control.tsx`, `src/lib/tv-protocol.ts` de la raíz, `tv-search.mjs`)
  — esta app implementa el lado TV del mismo protocolo, así que `/control` (ya
  desplegado en producción) funciona sin cambios.
- Sin micrófono en la TV en esta v1 — la búsqueda por voz/texto se hace desde
  el teléfono conectado (`/control` ya tiene input + botón de voz).
