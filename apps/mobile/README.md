# Cinéfilo Mobile (Capacitor)

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
