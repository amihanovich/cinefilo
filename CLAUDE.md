# Cinéfilo — Guía del proyecto (fuente de verdad)

Este archivo se autocarga en cada sesión. Es el **resumen** de qué es Cinéfilo, cómo trabajar acá, y qué
enfoques descartamos. Para el detalle técnico (endpoints, pairing, deploy, env vars) ver **`ARCHITECTURE.md`**.

## Git Workflow

**Branch de desarrollo activo: `dev`** — todos los cambios se commitean y pushean a `dev` salvo indicación
contraria (`git push origin dev`). Railway deploya `dev` automáticamente.

---

## Qué es Cinéfilo (producto real)

Recomendador conversacional de pelis/series. El foco es la **app móvil**:

1. El usuario baja la **app móvil**, le pide a Cinéfilo qué ver (**voz o texto**), y lo reproduce en la app
   de **streaming** que ya tiene (deep-link). Funciona solo con eso.
2. Si tiene la **app de TV**, toca **"Conectar TV"**, escanea el QR, y la **app móvil se vuelve control
   remoto** (la experiencia visual pasa a la TV).
3. Si llega a una TV con Cinéfilo y no quiere instalar la móvil, **escanea el QR** y la maneja desde la
   **web-control**.

El AI es **Claude Haiku** (`claude-haiku-4-5-20251001`) vía un backend Node en Railway. Devuelve 1
recomendación principal + N alternativas, con refinamiento conversacional, feedback de gustos y voz (STT/TTS).

## Los clientes (resumen — detalle en ARCHITECTURE.md)

| App | Qué es | Packaging |
|---|---|---|
| **`apps/mobile`** | La app principal (recomendador por voz/texto + control de TV) | APK Capacitor, bundlea el front, `com.cinefilo.app` |
| **`apps/tv`** | App de TV = **cáscara WebView** que carga `public/tv-lite.html` (remoto) | APK Capacitor, `server.url`, `com.cinefilo.tv` |
| **`apps/web-control`** | Control web (D-pad) que abre el QR de la TV | Servicio Railway propio |
| **`src/` (web)** | Recomendador web (TanStack Start). **Legacy/secundaria**, salvo `/control` (D-pad web, vivo) | Sirve la web + el backend `/api/*` |
| **`apps/landing`** | Landing de descargas (QRs desde un manifest en Supabase) | Servicio Railway propio |

**Backend (raíz):** `server-node.mjs` rutea `/api/recommend`, `/api/intent`, `/api/orb`, `/api/ask`,
`/api/tv-home*`, `/api/tv-search`, `/api/transcribe`, `/api/tts`, `/api/ping`, y sirve la web SSR. Módulos
autónomos: `recommend.mjs`, `tv-search.mjs`, `transcribe.mjs`, `tts.mjs`.

**Pósters:** Cinemeta (Stremio) primero, iTunes + Wikipedia de fallback — en TODOS los clientes.

**Pairing TV↔control:** Supabase Realtime, canal `cinefilo:<sessionId>`, roles `tv`/`control`, protocolo en
`tv-protocol.ts`. ⚠️ Ese archivo (+ `use-tv-channel.ts`, `stt.ts`) está copiado a mano en 4 lugares y ya
divergió — cuidado al tocarlo.

---

## Enfoques descartados y por qué (NO revivir)

Cinéfilo pasó por varias versiones. Estos enfoques se **eliminaron del repo** (2026-07) — si aparecen en
memorias viejas o en tu cabeza, ignorarlos:

- **Modo Social** (usuarios cercanos, matches por geolocalización): `social.functions.ts` +
  `SocialModeToggle`/`NearbyUsersStrip`/`SocialMatchOverlay`. Borrado. Las tablas `user_presence` /
  `social_matches` quedaron en Supabase sin uso (no se dropearon) — ignorarlas.
- **Swipe / "choose" socrático** (deck de tarjetas + `chooseFromLiked`): reemplazado por la pantalla de
  resultados directa. Borrado (`SwipeCardDeck`, `MatchOverlay`, `chooseFromLiked`).
- **Prototipo "Cast a TV" viejo** (Chromecast CAF + canal `cinefilo:session:`): `cast-test.tsx`, `routes/tv.tsx`,
  `public/tv.html`. Superado por la **app de TV Android + `/control`** (protocolo nuevo `cinefilo:<id>`). Borrado.
- **`apps/tv/src` (SPA React de TV):** abandonada. El APK de TV es una **cáscara** que carga `tv-lite.html`
  remoto, no ese bundle. `apps/tv/src` quedó como placeholder mínimo (solo para que `cap sync` no falle).
- **UI web del recomendador** (`src/routes/index.tsx`, `wizard.tsx`): legacy/secundaria, anterior a la app
  móvil. Se mantiene funcionando pero NO es el foco. (El backend y `/control` que sirve ese mismo server SÍ
  son esenciales.)
- **Componentes web huérfanos** borrados: `VoiceOrb`, `PlatformOrbit`, `PlatformLogo`, `Onboarding`.
- **Cloudflare / Workers:** evaluado, no se usa. Deploy es Node/Railway (`server-node.mjs`), NO
  `.output/...`. `wrangler.jsonc` borrado.

---

## Notas de desarrollo

1. **AI:** siempre `claude-haiku-4-5-20251001` en producción. No bajar `maxOutputTokens`/`max_tokens` de 800
   en recommend (el JSON se trunca).
2. **TypeScript:** sin `any`; Zod valida en runtime en los server fns / módulos del backend.
3. **Voz:** STT vía `/api/transcribe` (Groq Whisper); TTS vía `/api/tts` (ElevenLabs). Si ElevenLabs falla o
   se queda sin créditos, los clientes caen a la voz nativa del dispositivo (`speechSynthesis`). Todos los
   micrófonos son **press-to-speak / press-to-stop**.
4. **Build APK (móvil/TV):** desde el checkout PRINCIPAL (`apps/mobile` o `apps/tv`), `JAVA_HOME` seteado,
   `./gradlew.bat clean assembleDebug` (gotcha: NO `cmd.exe /c "gradlew.bat"` — no ejecuta gradle). Verificar
   el mtime del APK antes de instalar. Detalle en `ARCHITECTURE.md` y en las memorias del proyecto.
5. **Watchlist / "Guardar":** `localStorage`, no DB.
6. **Actualizar la TV sin rebuild:** editar `public/tv-lite.html` + redeployar el backend → el APK de TV ya
   instalado muestra la versión nueva (carga la URL remota).

Detalle completo de arquitectura, endpoints, pairing, deploy y env vars: **`ARCHITECTURE.md`**.
