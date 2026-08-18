# Miru — Arquitectura (fuente de verdad)

Referencia técnica de qué ES Miru hoy. Para el resumen de producto y las convenciones de trabajo,
ver `CLAUDE.md`. Este documento se mantiene al día cuando cambia la arquitectura.

> Monorepo: **1 backend Node + varios frontends** que lo consumen. Todo lo de AI pasa por el backend
> en Railway; las apps Capacitor y las webs son clientes. Branch activo: **`dev`** (deploy automático).

## ⚠️ Identificadores legacy "cinefilo" que NO se renombran (rebranding Miru, 2026-08)

La marca visible, los prompts y las claves de localStorage ya son **Miru** (las claves viejas se
migran al boot de cada cliente). Estos identificadores conservan el nombre viejo A PROPÓSITO —
renombrarlos rompe cosas en producción:

| Identificador | Dónde | Por qué no se toca |
|---|---|---|
| appIds `com.cinefilo.app` / `com.cinefilo.tv` | `apps/{mobile,tv}/capacitor.config.ts` | Cambiar el appId = app Android NUEVA: pierde datos y updates de los usuarios |
| Dominios `cinefilo-production` / `cinefilo-copy-production` / `webappcinefilo-production` | fallbacks en `lib/api.ts`/`stt.ts`/`tts.ts` de móvil y web-control, `CONTROL_BASE` en `tv-lite.html`, `server.url` del APK TV | Los APKs instalados los llevan **compilados**; si el dominio muere, las apps quedan muertas hasta reinstalar |
| Canal Realtime `cinefilo:${sessionId}` | `tv-lite.html` + las 3 copias de `use-tv-channel.ts` | Es el wire del pairing: renombrar de un lado rompe el pairing con APKs viejos en silencio |
| Wire-names `ADD_TODAY` / `SHOW_TODAY` / `todayTitles` | `tv-protocol.ts` (3 copias) + `tv-lite.html` | Mismo motivo: contrato TV↔control ya desplegado. En UI el concepto ahora es "Mi lista" |
| Campo JSON `cinephile_note` | prompts + clientes | Contrato de datos entre backend y clientes |
| Global `window.CinefiloSB` | `public/tv-supabase.js` | El bundle puede quedar cacheado en WebViews; el entry nuevo expone `MiruSB` **y** `CinefiloSB`, y tv-lite acepta ambos |
| Claves localStorage `cinefilo:*` / `queveo:*` viejas | código de migración (`lib/storage.ts` de cada app, IIFE en tv-lite) | Se leen una vez para migrar a `miru:*`; no borrar el código de migración hasta que la base instalada rote |

---

## 1. El producto (UX real)

El foco es la **app móvil**:

1. El usuario baja la **app móvil**, le pide a Miru qué ver (voz o texto), y lo **reproduce en la app
   de streaming** que ya tiene instalada (Netflix, Max, etc.) vía deep-link. Esto funciona sin nada más.
2. Si además tiene la **app de TV** instalada en su televisor, toca **"Conectar TV"** en la móvil: escanea
   el QR de la TV y la **app móvil se transforma en control remoto** — la experiencia visual pasa a la TV.
3. Si llega a una TV que ya tiene Miru y **no** quiere instalar la app móvil, **escanea el QR** con el
   navegador y la controla desde la **web-control** (réplica de lo que hace la móvil como control).

La **UI web del recomendador** (`src/routes`) es una versión browser del recomendador — **legacy/secundaria**,
anterior a la app móvil. No es la app de TV. El **servidor que la sirve sí es esencial** (hostea el backend +
`tv-lite.html` + `/control`).

---

## 2. Backend (raíz) — el cerebro

Entrada: **`server-node.mjs`** (servidor `http` nativo de Node; Railway lo arranca con `node server-node.mjs`).
Sirve el bundle SSR de la web (`dist/`) **y** expone la API REST que consumen TODAS las apps. CORS `*` en
`/api/*` (las apps Capacitor sirven desde `https://localhost`). Al arrancar precalienta el home de TV.

| Ruta | Método | Módulo → función | Qué hace |
|---|---|---|---|
| `/api/recommend` | POST | `recommend.mjs` → `recommend()` | Recomendación conversacional (1 main + N alternativas). Móvil + TV. |
| `/api/intent` | POST | `recommend.mjs` → `inferIntent()` | Frase corta con la intención del pedido (para estados de búsqueda). |
| `/api/orb` | POST | `recommend.mjs` → `orbRespond()` | Orbe del control: ¿pregunta sobre el título en pantalla o busca algo nuevo? |
| `/api/ask` | POST | `recommend.mjs` → `askAboutTitle()` | Pregunta conversacional sobre un título (no re-recomienda). |
| `/api/tv-home` | GET | `tv-search.mjs` → `tvHome()` | Home de TV: `items` (recomendadas + estrenos) **+ `rows`** (tiras "Top 10 en X" por plataforma). Cacheado 6h en memoria. |
| `/api/tv-home-more` | POST | `tv-search.mjs` → `tvHomeMore()` | Carga infinita del home de TV. |
| `/api/top-platforms` | GET | `tv-search.mjs` → `tvTop()` | Solo las `rows` del home (las tiras "Top 10 en X") — las consume el móvil. Mismo caché de 6h. |
| `/api/tv-search` | GET/POST | `tv-search.mjs` → `tvSearch()` | Búsqueda para la TV liviana. |
| `/api/transcribe` | POST | `transcribe.mjs` → `transcribeAudio()` | STT (audio → texto). |
| `/api/tts` | POST | `tts.mjs` → `ttsAudio()` | TTS (texto → `audio/mpeg`). |
| `/api/ping` | GET | inline | Warmup barato (cold start de Railway). |
| resto | — | `dist/server/server.js` | SSR de la web app. |

Los `.mjs` de la raíz son **autónomos** (no dependen del bundle de la web); replican la lógica de
`src/lib/recommendations.functions.ts`.

**Modelo AI:** Anthropic **`claude-haiku-4-5-20251001`** en TODO el backend, vía REST a `api.anthropic.com`
(`ANTHROPIC_API_KEY`). No bajar `max_tokens` de 800 en recommend (el JSON se trunca).

**Proveedores externos:**
- **ElevenLabs** TTS (`tts.mjs`): voz `ErXwobaYiN019PkySvjV` (Antoni), `eleven_multilingual_v2`.
  `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID` opcional). Si falla/sin créditos, los clientes caen a la
  voz nativa del dispositivo (`speechSynthesis`).
- **Groq Whisper** STT (`transcribe.mjs`): `whisper-large-v3`, idioma `es`, `GROQ_API_KEY`.
- **TMDB** (`availability.mjs`, `TMDB_API_KEY`): valida disponibilidad real por país y alimenta el
  home de TV vía `discoverPopular(country)` — 6 plataformas × movie/tv × popular/recent = 24 requests
  paralelos a Discover. Devuelve `{popular, recent, byPlatform}`: `byPlatform` es el ranking POR
  plataforma (para las tiras "Top 10 en X"), dedupe solo dentro de cada plataforma, del MISMO batch.
  ⚠️ El "Top 10" es popularidad TMDB por región, no el ranking oficial de cada plataforma (ese dato no
  tiene API pública). ⚠️ El caché del home no tiene key de región: el top es de `DEFAULT_REGION` (AR)
  para todos.
- **Pósters:** **Cinemeta (Stremio) primero**, iTunes + Wikipedia de fallback (ver §5).

---

## 3. Los clientes

### A. `apps/mobile` — app Android Capacitor (LA principal)
- `appId com.cinefilo.app`, `webDir dist`, **sin `server.url`** → bundlea el front (SPA React + Vite) dentro
  del APK. `capacitor.config.ts` solo setea `androidScheme: "https"`.
- Entrada: `src/main.tsx` → `src/App.tsx` → **`src/wizard.tsx`** (todo el flujo). Screens:
  `"welcome" | "magic" | "gallery"`.
- Flujo: **welcome** (`WelcomeScreen.tsx`, saludo por voz) → búsqueda por **voz** (`VoiceAgent.tsx` + `Orb.tsx`,
  STT `/api/transcribe`, TTS `/api/tts`) **o texto** → **resultados** (`/api/recommend`), con estado de carga
  `SearchLoading.tsx` (rueda de plataformas). `AccountSheet.tsx` = cuenta/galería de gustos.
- **Modo control de TV:** `src/screens/ControlScreen.tsx` + `src/hooks/use-tv-channel.ts` + `src/lib/tv-remote.ts`.
  Escanea el QR de la TV (`@capacitor-mlkit/barcode-scanning`) y se conecta como rol "control".
- Backend: `src/lib/api.ts` → `VITE_API_BASE_URL ?? https://cinefilo-production.up.railway.app`.
- Build APK: `npm run apk` (Gradle `assembleDebug`). NO se deploya en Railway.

### B. `apps/tv` — app de TV Android (CÁSCARA / WebView)
- `appId com.cinefilo.tv`. Es una **cáscara**: `server.url` en `apps/tv/capacitor.config.ts` apunta a
  **`https://cinefilo-production.up.railway.app/tv-lite.html`**. El APK carga esa TV liviana remota; el bundle
  local (`apps/tv/src`, un placeholder mínimo) **nunca se muestra** — existe solo para que `cap sync` no falle.
- **Consecuencia:** actualizar `public/tv-lite.html` + redeployar el backend actualiza la TV **sin rebuildear
  el APK**. Solo hace falta rebuild si cambia la URL, el manifest, el icono/banner o los `<queries>`.
- `public/tv-lite.html` (+ `public/tv-supabase.js`, `/api/tv-*`) es la TV real. `public/tv-lite.html` es
  self-contained; `tv-supabase.js` (bundle de Supabase) lo carga para el pairing Realtime.
- **Modos de UI de la TV** (rebranding Miru, 2026-08): al abrir muestra una **pantalla de elección**
  (mecánica Disney+) — "Vincular el teléfono" (QR) o "Usar el control de la TV". Estado `uiMode`
  (`choose|pair|rc|linked`). En **modo RC** la home suma una fila de tabs (Buscar con teclado en
  pantalla D-pad / Mi lista / Ya vistas / Plataformas); en **modo vinculado** la UI queda limpia y
  todo se maneja desde el control. Si el control pierde presencia ya NO se expulsa al QR: banner
  discreto y el contenido sigue navegable. La **sesión de pairing persiste 30 días** en
  `miru:tv:session` (QR estable entre recargas). El "carrito Para hoy" pasó a ser **"Mi lista"**
  (`miru:tv:mylist`, wire-legacy `ADD_TODAY`/`todayTitles`); "Ya vistas" del modo RC en `miru:tv:seen`;
  filtros RC en `miru:tv:platforms`. Al lanzar una app de streaming se muestra la rueda "Abriendo X…".

### C. `apps/web-control` — control web standalone (D-pad)
- SPA Vite servida por su propio `server.mjs` en un **servicio Railway aparte**. `src/ControlScreen.tsx` +
  `use-tv-channel.ts` + `tv-protocol.ts`. Es la página que abre el QR de la TV cuando NO se usa la app móvil,
  y es la **réplica del control remoto de la app móvil**: mic vivo integrado (tap = grabar, tap =
  buscar), input de texto, filtros (plataformas + "Priorizar los más recientes", persistidos y
  re-emitidos con `SET_PLATFORMS` en cada cambio), atajos Mi lista (sheet con carátulas desde
  `SCREEN.myList`) / Ya vistas, D-pad + OK contextual, y rueda de búsqueda propia (además de la de
  la TV). Ambos controles se mantienen espejados a mano.
- **Sin `?session=`** (URL pelada, sin escanear el QR): redirige a la **web touch** —
  `tv-lite.html?touch=1` en el backend principal, la misma UI de la TV en modo control tradicional
  pero clickeable/tocable (tablets y laptops). Con `?session=` el control funciona como siempre.

### D. `src/` — web app del recomendador (TanStack Start, SSR) — LEGACY/secundaria
- La misma que sirve `server-node.mjs`. Rutas vivas: `_authenticated/index.tsx` (home + resultados),
  `wizard.tsx`, `login.tsx`, `reset-password.tsx`. Lógica AI en `src/lib/recommendations.functions.ts`
  (server fns).
- **`control.tsx` (`/control`) quedó viejo** (lista scrolleable + FOCUS, sin D-pad ni "Mi lista") y **el QR de
  la TV ya no lo abre**: apunta a la web-control (C). Se mantiene solo por links viejos; el control web que se
  mantiene es `apps/web-control`.
- La UI del recomendador (`index.tsx`/`wizard.tsx`) es legacy; se mantiene pero no es el foco.

### E. `apps/landing` — landing de descargas
- SPA Vite, servicio Railway propio. Lee un **manifest** en Supabase Storage con las builds y genera QRs.
  Publicación: `scripts/publish-build.mjs` (`SUPABASE_SERVICE_ROLE_KEY`, `BUILDS_BUCKET`).

---

## 4. Pairing TV ↔ control (Supabase Realtime)

Transporte: **Supabase Realtime broadcast**. Protocolo en `tv-protocol.ts`.

- **Canal:** `cinefilo:${sessionId}` (`channelName()` en `use-tv-channel.ts`), sessionId = 6 bytes hex.
- **Roles / presence:** `"tv"` y `"control"`; `broadcast.self=false`; el pairing se detecta por presencia.
- **Eventos:** `"command"` (control→TV) y `"state"` (TV→control). Validados con Zod (`discriminatedUnion`).
  - Control→TV: `SEARCH` (+ `preferRecent` opcional), `FOCUS`, `LOAD_MORE`, `REMOVE`, `SET_PLATFORMS`
    (lista vacía = todas), `SHOW_LIST`, `NAVIGATE`, `SELECT`, `BACK`, `PLAY`, `ADD_TODAY`, `OPEN_DETAIL`.
  - TV→Control: `PAIRED`, `SCREEN` (home/search/detail/player + items + focusedId + todayTitles +
    `myList` opcional con los ítems completos de "Mi lista"), `NOW_PLAYING`.
  - Wire-legacy: `ADD_TODAY`/`SHOW_TODAY`/`todayTitles` conservan su nombre aunque la UI diga
    "Mi lista" (ver tabla de identificadores legacy arriba). Los campos nuevos son aditivos:
    los clientes viejos los ignoran (Zod no-strict).
- **QR:** la TV genera `<CONTROL_BASE>/control?session=<id>`, donde `CONTROL_BASE` es el **servicio
  web-control** (`cinefilo-copy-production.up.railway.app`), definido en `public/tv-lite.html` (override para
  dev: abrir tv-lite con `?control=<base-url>`). ⚠️ NO usar el origin del backend: ahí vive el `/control`
  viejo. Ese QR lo abre la web-control, o lo escanea la app móvil (`parseSession()` saca el `session` de
  cualquier URL, así que el host no le importa).
- **⚠️ Deuda:** `tv-protocol.ts`, `use-tv-channel.ts` y `stt.ts` están **copiados a mano** en `src/lib/`,
  `apps/web-control/src/lib/` y `apps/mobile/src/lib/`, y **ya divergieron**. Cualquier drift rompe el pairing
  en silencio. Candidato a paquete compartido (pendiente).

---

## 5. Pósters (estándar único)

**Cinemeta (Stremio) primero, iTunes + Wikipedia de fallback**, en todos los clientes:
- Móvil: `apps/mobile/src/lib/posters.ts`.
- Web: `src/lib/itunes.ts` (client-side) y `src/lib/posters.functions.ts` (server fn SSR; iTunes está
  IP-bloqueado server-side, por eso Cinemeta es clave ahí).
- Cinemeta: `https://v3-cinemeta.strem.io/catalog/{movie|series}/top/search=<título>.json` → `poster`.
- Cinemeta es más confiable que iTunes (sin rate-limiting agresivo, CDN de Stremio). iTunes quedaba sin
  póster en ráfagas de búsquedas.

---

## 6. Deploy — Railway (NIXPACKS, Node 22)

| Servicio | Config | Start | Dominio |
|---|---|---|---|
| Backend + web | raíz `railway.json`/`nixpacks.toml` | `node server-node.mjs` | `cinefilo-production.up.railway.app` |
| web-control | `apps/web-control/` | `node server.mjs` | `cinefilo-copy-production.up.railway.app` |
| landing | `apps/landing/` | `node server.mjs` | (servicio propio) |

- Branch conectado: **`dev`** (deploy automático al push). Restart `ON_FAILURE`, max 3.
- Apps Capacitor (móvil, TV): NO se deployan; se compilan a APK y se distribuyen por la landing/manifest.

---

## 7. Datos / Supabase

Un proyecto (PostgreSQL + Auth + Realtime). Migraciones en `supabase/migrations/`. Auth email+password;
`getOptionalUser()` permite invitados. Watchlist "Guardar" vive en `localStorage`, no en DB.

- **`profiles`** — VIVO: `user_id`, `default_platforms[]`, `display_name`, `avatar_color`.
- **`title_feedback`** — VIVO: sentiment `love|like|dislike|seen`. Galería de gustos, exclusiones,
  personalización del prompt. CRUD en `src/lib/feedback.functions.ts`.
- **`user_presence`, `social_matches`** — del **Modo Social (descartado)**. Sin código vivo que las use.
  Las tablas siguen en la DB (no se dropearon); ignorarlas. Ver "Enfoques descartados" en `CLAUDE.md`.
- **Realtime** (broadcast) — VIVO, central para el pairing (no depende de tablas).

---

## 8. Variables de entorno

- **Backend:** `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` (+`ELEVENLABS_VOICE_ID`), `GROQ_API_KEY`, `PORT`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Web (Vite):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- **Apps Capacitor / web-control:** `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_CONTROL_BASE_URL` (TV), `VITE_MOBILE_APP_URL`, `VITE_POSTHOG_KEY`.
- **Landing:** `VITE_MANIFEST_URL`, `VITE_WEB_CONTROL_URL`; publish usa `SUPABASE_SERVICE_ROLE_KEY`, `BUILDS_BUCKET`.
- ⚠️ Dos convenciones para la key de Supabase: `VITE_SUPABASE_PUBLISHABLE_KEY` (web) vs `VITE_SUPABASE_ANON_KEY` (apps).
