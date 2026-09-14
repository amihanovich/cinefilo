# Miru Mobile (Capacitor)

Vite SPA + Capacitor → APK / IPA nativa.

## Setup

```bash
cd apps/mobile
npm install
cp .env.example .env.local   # editar VITE_API_BASE_URL si hace falta
```

## Desarrollo en browser

```bash
npm run dev
# abre http://localhost:5173
```

## Build + APK Android

Prerequisitos: Java 17+, Android Studio, `ANDROID_HOME` seteado.

```bash
npm run build           # genera dist/
npx cap add android     # primera vez: crea carpeta android/
npx cap sync android    # copia dist/ + plugins a android/
cd android
./gradlew assembleDebug
# APK en: android/app/build/outputs/apk/debug/app-debug.apk
```

O con el script shortcut:
```bash
npm run apk
```

## Build + IPA iOS (requiere Mac + Xcode)

```bash
npm run build
npx cap add ios        # primera vez
npx cap sync ios
npx cap open ios       # abre Xcode → Archive → Distribute
```

## Arquitectura

- `src/wizard.tsx` — pantalla principal (welcome → platforms → magic)
- `src/lib/api.ts` — cliente HTTP que llama `POST /api/recommend` en el backend Railway
- `src/lib/context.ts` — inferencia de contexto temporal (hora, día, temporada)
- `src/lib/deeplink.ts` — Universal Links para abrir apps de streaming nativas
- Backend: `server-node.mjs` + `recommend.mjs` en la raíz del monorepo

## Deep links a streaming

El botón "Ver ahora" usa Universal Links (URLs HTTPS). En iOS/Android, si la app de streaming está instalada, el SO la abre directamente. Si no, abre el browser.

## Control remoto de la TV (escaneo de QR)

El ícono de TV en el header (y la sección "Miru en tu TV" en Mi cuenta) abre la
cámara para escanear el QR de la app de TV y usar el teléfono como
control remoto (`src/screens/ControlScreen.tsx`). Usa el plugin
`@capacitor-mlkit/barcode-scanning`.

Tras `npx cap sync android`, agregá a mano al `AndroidManifest.xml`
(`android/app/src/main/AndroidManifest.xml`):

```xml
<!-- hijo directo de <manifest> -->
<uses-permission android:name="android.permission.CAMERA" />

<!-- dentro de <application> — para que Play Services pre-baje el escáner -->
<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />
```

Notas:
- El escáner (`scan()`) necesita Google Play Services. Si no está disponible, la
  app cae automáticamente a "ingresar el código a mano" (el hex que aparece
  bajo el QR en la TV).
- En el browser de desarrollo el plugin nativo no existe: probá el control con
  `http://localhost:5173/?tvsession=<id>` (el id de sesión de la TV).
