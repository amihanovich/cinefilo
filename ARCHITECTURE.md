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
| ~~Dominio `cinefilo-production`~~ **MIGRADO a `miru-ai.up.railway.app`** (2026-08) | `server.url` del APK TV, fallbacks en `lib/api.ts`/`stt.ts`/`tts.ts` de móvil y web-control, **y los `.env.example` de cada app** | A diferencia de los otros 3 dominios (que se leen en vivo y no rompen nada instalado), este SÍ está compilado dentro de los APKs — **el APK de TV y el móvil instalados quedan muertos hasta reinstalarlos** con el build nuevo. ⚠️ **Gotcha:** `VITE_API_BASE_URL` del `.env` LOCAL (gitignored, copiado del `.env.example`) **pisa el fallback del código** — al migrar un dominio hay que actualizar el `.env.example` **y avisar de actualizar el `.env` local**, si no el build compila el dominio viejo y la app queda sin backend (pasó en la migración de 2026-08: búsquedas y tiras fallaban en silencio) |
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
| `/api/tv-home` | GET | `tv-search.mjs` → `tvHome()` | Home de TV: `items` (recomendadas + estrenos) **+ `rows`** (tiras "Top 6 en X" por plataforma). Cacheado 6h en memoria. |
| `/api/tv-home-more` | POST | `tv-search.mjs` → `tvHomeMore()` | Carga infinita del home de TV. |
| `/api/top-platforms` | GET | `tv-search.mjs` → `tvTop()` | Solo las `rows` del home (las tiras "Top 6 en X") — las consume el móvil. Mismo caché de 6h. |
| `/api/tv-search` | GET/POST | `tv-search.mjs` → `tvSearch()` | Búsqueda para la TV liviana. **Forma liviana** (2026-09): pide a Haiku solo título/plataforma/año/tipo (18 ítems, `max_tokens` 1200), valida en TMDB en la misma respuesta y devuelve ≤15 con `avail: "confirmed" \| "unknown"`. Sin `synopsis/hook/reason`. |
| `/api/tv-blurb` | POST | `tv-search.mjs` → `tvBlurb()` | **Texto de UN título bajo demanda**: una frase (25-35 palabras) "de qué va + por qué encaja con el pedido" (`{title, year, type, platform, q, section}` → `{blurb, cached}`). La TV lo pide solo para el título del banner/ficha. Caché 24 h por título+pedido, dedupe en vuelo, `max_tokens` 160, timeout 12 s. Cubeta de rate limit propia (60/min/IP, `ratelimit.mjs`). |
| `/api/tv-ribbons` | GET | `tv-search.mjs` → `tvRibbons()` | Pósters de las cintas de la pantalla del QR (solo Discover cacheado, sin IA). |
| `/api/availability-status` | GET | `availability.mjs` → `availabilityStatus()` | Diagnóstico de TMDB (¿ve la key? ¿responde?). |
| `/api/transcribe` | POST | `transcribe.mjs` → `transcribeAudio()` | STT (audio → texto). |
| `/api/tts` | POST/GET | `tts.mjs` → `ttsStream()` | TTS (texto → `audio/mpeg`, streaming). |
| `/api/ping` | GET | inline | Warmup barato (cold start de Railway). |
| `/tv` | — | inline | 302 → `/tv-lite.html` (para tipear con el control remoto). |
| resto | — | `dist/server/server.js` | SSR de la web app. |

**Rate limit** por IP y minuto (`ratelimit.mjs`, en memoria por proceso): general 90 (`/api/*` salvo ping), IA 20
(recommend, tv-search, tv-home-more, transcribe, tts, ask, orb, intent) y **blurb 60 en cubeta aparte** (navegar
tarjetas en la TV no bloquea las búsquedas).

**Métricas** (2026-09): cada búsqueda/blurb loguea una línea `[metrics] {...}` (llm_ms, tmdb_ms, asked, returned,
confirmed, unknown, dropped, cached) para comparar antes/después. La TV loguea `[metrics-tv]` (submit → rueda →
respuesta → navegable → primera carátula → primer texto; con `?debug=1` se ve en un overlay). El móvil manda
`search_timing` a PostHog.

**Parse defensivo** (`parseLooseJson`): si Haiku trunca el JSON, se rescatan los ítems completos en vez de 500.

**Disponibilidad expuesta**: `pickAvailable(..., expose=true)` deja `avail` en cada ítem de `/api/tv-search`,
`/api/tv-home-more` y el home (`confirmed` = verificado en TMDB, incluida corrección de plataforma; `unknown` = solo
lo dijo la IA). `none`/`unlisted` nunca viajan. La TV pinta `unknown` como "Por confirmar en X" (pastilla gris, sin
atribución JustWatch). `/api/recommend` (APK móvil) NO expone el campo.

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
  plataforma (para las tiras "Top 6 en X"), dedupe solo dentro de cada plataforma, del MISMO batch.
  ⚠️ El "Top 6" es popularidad TMDB por región, no el ranking oficial de cada plataforma (ese dato no
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
- Backend: `src/lib/api.ts` → `VITE_API_BASE_URL ?? https://miru-ai.up.railway.app`.
- Build APK: `npm run apk` (Gradle `assembleDebug`). **Además** se sirve como web (`apps/mobile/server.mjs` +
  `railway.json`/`nixpacks.toml`, root `apps/mobile`) en `webapp-miru-production.up.railway.app` — "Miru en la
  compu" para quien no tiene Android; la landing la linkea. Es la web que sigue (decisión 2026-09); la legacy
  `src/` se retira más adelante.
- **"Abiertos recientemente"** (`src/lib/opened.ts`, `miru:opened`, 2026-09): registro local de cada "Ver en X"
  (título, plataforma, fecha, `via`: deeplink / app-search / web / google, `confirmed`). Tira en la bienvenida
  y en los resultados (`RecentOpened.tsx`; tocar vuelve a abrir re-consultando JustWatch) + contador en Mi
  cuenta. NO es progreso de reproducción (no inventa episodio/minuto; no captura lo visto fuera de Miru).

### B. `apps/tv` — app de TV Android (CÁSCARA / WebView)
- `appId com.cinefilo.tv`. Es una **cáscara**: `server.url` en `apps/tv/capacitor.config.ts` apunta a
  **`https://miru-ai.up.railway.app/tv-lite.html`**. El APK carga esa TV liviana remota; el bundle
  local (`apps/tv/src`, un placeholder mínimo) **nunca se muestra** — existe solo para que `cap sync` no falle.
- **Consecuencia:** actualizar `public/tv-lite.html` + redeployar el backend actualiza la TV **sin rebuildear
  el APK**. Solo hace falta rebuild si cambia la URL, el manifest, el icono/banner o los `<queries>`.
- `public/tv-lite.html` (+ `public/tv-supabase.js`, `/api/tv-*`) es la TV real. `public/tv-lite.html` es
  self-contained; `tv-supabase.js` (bundle de Supabase) lo carga para el pairing Realtime.
- **Modos de UI de la TV** (revisión con Carlos, 2026-09): al abrir muestra **directamente el QR**
  (`uiMode = "pair"`, la raíz) con la indicación "cualquier flecha u OK empieza": la primera tecla del
  control físico entra al **modo RC** (`enterRc()`, solo entra, no mueve el foco); un comando del
  teléfono pasa a **vinculado**. Ya no hay pantalla previa de elección. Estado `uiMode` (`pair|rc|linked`);
  `pairReturn` (`root|rc`) dice a dónde vuelve BACK desde el QR (raíz = el sistema cierra la app; desde el
  tab "Vincular teléfono" vuelve a RC). BACK en la raíz del home muestra el QR. En **modo RC** la home suma
  una fila de tabs (Mic / Buscar con teclado D-pad / Mi lista / Ya vistas / Plataformas / ▶ Abiertos /
  Vincular teléfono); en **modo vinculado** la UI queda limpia y todo se maneja desde el control.
- **Layout** (2026-09, patrón Prime Video): **un solo banner** que es la ficha de la tarjeta enfocada
  (`heroItem()`: tile "Top 6" o ítem de la grilla; `syncHero()` parchea solo el banner). Se fue el
  carrusel de 5 (`TOP`/`heroIndex`): **todos** los resultados van en la grilla desde el primero, 6 por
  fila (`COLS` en JS = `--cols` en CSS), tarjetas solo imagen+título+pastilla. El banner mide 32vh (173 px
  a 960×540 —viewport CSS de 1080p con DPR 2—, 220 px a 720p) para que la primera fila quede a la
  vista. Navegación: grilla ←/→ ±1, ↑/↓ ±COLS; desde la fila 0, ↑ sube a las tiras Top 6 (home) o a los
  botones del banner (RC) y de ahí al menú. OK = ficha, OK doble = Mi lista. Touch: 1er toque elige, 2º
  abre la ficha.
- **Texto bajo demanda** (2026-09): sinopsis + "por qué" son **una frase** (`blurb`) que la TV pide a
  `/api/tv-blurb` **solo** para el título del banner (el primero al llegar resultados; después el que se
  enfoca, con debounce de 250 ms) o la ficha. Estado en el ítem (`_bs`), sin repetir pedidos; una respuesta
  tardía escribe en su ítem y solo repinta si sigue en pantalla. Ítems con forma vieja (home cacheado,
  listas guardadas) usan `hook`/`reason`/`synopsis` como fallback (`blurbOf()`), sin pedir nada.
- **Estados de búsqueda**: rueda inmediata; "No encontré nada para «q»" (vacío) y "No pudimos buscar" +
  **Reintentar** (error; OK / control / click repiten el pedido).
- **"Abiertos recientemente"** (`miru:tv:opened`): `play()` registra cada "Ver en X" (título, plataforma,
  fecha, `via`); tab "▶ Abiertos" en RC, comando `SHOW_OPENED` desde el control y `SCREEN.opened`. Si el control pierde presencia ya NO se expulsa al QR: banner
  discreto y el contenido sigue navegable. La **sesión de pairing persiste 30 días** en
  `miru:tv:session` (QR estable entre recargas). El "carrito Para hoy" pasó a ser **"Mi lista"**
  (`miru:tv:mylist`, wire-legacy `ADD_TODAY`/`todayTitles`); "Ya vistas" del modo RC en `miru:tv:seen`;
  filtros RC en `miru:tv:platforms`. Al lanzar una app de streaming se muestra la rueda "Abriendo X…".

### C. `apps/tizen` — app de Samsung Smart TV (Tizen, CÁSCARA)
- Mismo espíritu que `apps/tv` (B) pero MÁS simple: sin Capacitor, sin build step, sin npm — un
  widget Tizen (`.wgt`) no tiene un campo de config equivalente a `server.url`, así que
  `apps/tizen/index.html` redirige a mano por JS a **`https://miru-ai.up.railway.app/tv-lite.html`**
  (mismo criterio de fondo violeta `#2A0F5C` mientras redirige). `apps/tizen/config.xml` declara
  `<access origin="*" subdomains="true"/>` — sin eso la política de origen de Tizen bloquea la
  navegación al dominio de Railway (es el equivalente Tizen de lo que en Android resuelve
  `server.url` directamente).
- **Misma consecuencia que la app de Android**: actualizar `tv-lite.html` + redeployar el backend
  actualiza la TV sola, sin reempaquetar el `.wgt`.
- **v1 sin deep-link nativo** a Netflix/Prime/etc.: "Ver ahora" cae al fallback web genérico que
  `tv-lite.html` ya usa para cualquier entorno sin el bridge de Capacitor (`openExternal()`,
  `window.open`) — los IDs internos de Tizen de cada app de streaming no son públicos y hace falta
  confirmarlos en un TV real; queda para una v2.
- Instalación **solo en modo desarrollador** (certificado de autor gratis vía Tizen Studio + modo
  desarrollador en el TV + `sdb`/`tizen install`), sin pasar por Samsung Seller Office (tienda
  oficial) — fuera de alcance por ahora. Detalle completo del setup en `apps/tizen/README.md`.
- El empaquetado se hace con `apps/tizen/build-wgt.ps1` (empaqueta desde un staging y verifica que
  el `.wgt` salga firmado). ⚠️ **La identidad de firma vive fuera del repo**: `miru-author.p12` +
  su contraseña. Tizen exige la MISMA firma de autor y el MISMO package ID (`MiruTV0001`) para
  actualizar una app ya instalada — si se pierde el `.p12`, cada copia instalada hay que
  desinstalarla y reinstalarla (se pierde Mi lista y la sesión del QR).

### C-bis. `apps/webos` — app de LG webOS (CÁSCARA)
- Gemela de `apps/tizen`, mismo redirect JS a `tv-lite.html` desde un `index.html` sin lógica.
  Cubre LG y las marcas que licencian webOS Hub (Hyundai, RCA, Konka). Manifiesto = `appinfo.json`
  (en vez de `config.xml`), paquete = `.ipk` (en vez de `.wgt`), CLI = `@webosose/ares-cli` (un
  paquete npm, no un SDK aparte).
- **Bastante menos trabajoso que Tizen**: el `.ipk` de modo desarrollador **NO se firma** — no hay
  certificados ni perfiles. Se empaqueta con `apps/webos/build-ipk.ps1`, que además verifica que
  adentro viajen solo los 4 archivos de la app.
- `appinfo.json` pone **`disableBackHistoryAPI: true`**: el botón Volver llega como keydown
  (**keycode 461**, mapeado en `tv-lite.html` junto al 10009 de Tizen) en vez de que webOS haga
  `history.back()` por su cuenta — así el back tiene UN solo camino, el mismo `backAction()`.
- ⚠️ **El modo desarrollador de LG expira a las ~50 horas** y hay que renovarlo desde la app
  Developer Mode; si vence, el TV desactiva las apps sideloadeadas. Necesita además una cuenta de
  desarrollador LG (gratis). Detalle en `apps/webos/README.md`.
- **No cambiar el `id`** (`com.miru.tv`): es la identidad de actualización, igual que el package ID
  en Tizen.

### D. `apps/web-control` — control web standalone (D-pad)
- SPA Vite servida por su propio `server.mjs` en un **servicio Railway aparte**. `src/ControlScreen.tsx` +
  `use-tv-channel.ts` + `tv-protocol.ts`. Es la página que abre el QR de la TV cuando NO se usa la app móvil,
  y es la **réplica del control remoto de la app móvil**: mic vivo integrado (tap = grabar, tap =
  buscar), input de texto, filtros (plataformas + "Priorizar los más recientes", persistidos y
  re-emitidos con `SET_PLATFORMS` en cada cambio), atajos Mi lista (sheet con carátulas desde
  `SCREEN.myList`) / Ya vistas / Abiertos (`SHOW_OPENED`), D-pad + OK contextual, y rueda de búsqueda
  propia (además de la de la TV). Ambos controles se mantienen espejados a mano.
- **D-pad** (2026-09, `lib/dpad.ts`): los **botones** mandan la dirección natural (◀ = foco a la izquierda,
  como el control físico); el **swipe** sobre el pad conserva el modelo "arrastrás el contenido" (dirección
  opuesta). La TV no distingue el origen (recibe `NAVIGATE` + dirección); por eso ↑/↓ en la ficha siguen
  ciclando entre botones en vez de mapear absoluto.
- **Sin `?session=`** (URL pelada, sin escanear el QR): redirige a la **web touch** —
  `tv-lite.html?touch=1` en el backend principal, la misma UI de la TV en modo control tradicional
  pero clickeable/tocable (tablets y laptops). Con `?session=` el control funciona como siempre.

### E. `src/` — web app del recomendador (TanStack Start, SSR) — LEGACY/secundaria
- La misma que sirve `server-node.mjs`. Rutas vivas: `_authenticated/index.tsx` (home + resultados),
  `wizard.tsx`, `login.tsx`, `reset-password.tsx`. Lógica AI en `src/lib/recommendations.functions.ts`
  (server fns).
- **`control.tsx` (`/control`) quedó viejo** (lista scrolleable + FOCUS, sin D-pad ni "Mi lista") y **el QR de
  la TV ya no lo abre**: apunta a la web-control (C). Se mantiene solo por links viejos; el control web que se
  mantiene es `apps/web-control`.
- La UI del recomendador (`index.tsx`/`wizard.tsx`) es legacy; se mantiene pero no es el foco.

### F. `apps/landing` — landing de descargas
- SPA Vite, servicio Railway propio. Lee un **manifest** en Supabase Storage con las builds y genera QRs.
  Publicación: `scripts/publish-build.mjs` (`SUPABASE_SERVICE_ROLE_KEY`, `BUILDS_BUCKET`).

---

## 4. Pairing TV ↔ control (Supabase Realtime)

Transporte: **Supabase Realtime broadcast**. Protocolo en `tv-protocol.ts`.

- **Canal:** `cinefilo:${sessionId}` (`channelName()` en `use-tv-channel.ts`), sessionId = 6 bytes hex.
- **Roles / presence:** `"tv"` y `"control"`; `broadcast.self=false`; el pairing se detecta por presencia.
- **Eventos:** `"command"` (control→TV) y `"state"` (TV→control). Validados con Zod (`discriminatedUnion`).
  - Control→TV: `SEARCH` (+ `preferRecent` opcional), `FOCUS`, `LOAD_MORE`, `REMOVE`, `SET_PLATFORMS`
    (lista vacía = todas), `SHOW_LIST`, `NAVIGATE`, `SELECT`, `BACK`, `PLAY`, `ADD_TODAY`, `OPEN_DETAIL`,
    `HOME`, `SHOW_TODAY`, `SHOW_OPENED`.
  - TV→Control: `PAIRED`, `SCREEN` (home/search/detail/player + items + focusedId + todayTitles +
    `myList` opcional con los ítems completos de "Mi lista" + `opened` opcional con "Abiertos
    recientemente"), `NOW_PLAYING`. `MediaItem` suma `blurb` (una frase: de qué va + por qué).
  - Wire-legacy: `ADD_TODAY`/`SHOW_TODAY`/`todayTitles` conservan su nombre aunque la UI diga
    "Mi lista" (ver tabla de identificadores legacy arriba). Los campos nuevos son aditivos:
    los clientes viejos los ignoran (Zod no-strict).
- **QR:** la TV genera `<CONTROL_BASE>/control?session=<id>`, donde `CONTROL_BASE` es el **servicio
  web-control** (`mirutv-touch.up.railway.app`), definido en `public/tv-lite.html` (override para
  dev: abrir tv-lite con `?control=<base-url>`). ⚠️ NO usar el origin del backend: ahí vive el `/control`
  viejo. Ese QR lo abre la web-control, o lo escanea la app móvil (`parseSession()` saca el `session` de
  cualquier URL, así que el host no le importa).
- **⚠️ Deuda:** `tv-protocol.ts`, `use-tv-channel.ts`, `stt.ts`, `tts.ts`, `Orb.tsx`, `dpad.ts` y
  `platform-mentions.ts` están **copiados a mano** en `src/lib/`, `apps/web-control/src/` y `apps/mobile/src/`
  (hoy semánticamente iguales — verificado 2026-09). Los que **sí divergieron**: `ControlScreen.tsx` ×2,
  `deeplink.ts` (web-control sin `deepLinkFor`), `api.ts`, `storage.ts`. La detección de plataforma en texto
  existe 4 veces (backend `availability.mjs`, móvil, web-control, ES5 en `tv-lite.html`). Cualquier drift
  rompe el pairing en silencio. Candidato a paquete compartido (pendiente).

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
| Backend + web | raíz `railway.json`/`nixpacks.toml` | `node server-node.mjs` | `miru-ai.up.railway.app` |
| web-control | `apps/web-control/` | `node server.mjs` | `mirutv-touch.up.railway.app` |
| landing | `apps/landing/` | `node server.mjs` | `landing-page-miru.up.railway.app` |
| web-app móvil | `apps/mobile/` (root dir) | `node server.mjs` | `webapp-miru-production.up.railway.app` |

- Branch conectado: **`dev`** (deploy automático al push). Restart `ON_FAILURE`, max 3.
- Apps Capacitor (móvil, TV): los APKs se compilan a mano y se distribuyen por la landing/manifest. La
  **app móvil además se deploya como web** (mismo bundle, sin plugins nativos) — ver §3.A.

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
