# Miru — Guía del proyecto (fuente de verdad)

Este archivo se autocarga en cada sesión. Es el **resumen** de qué es Miru, cómo trabajar acá, y qué
enfoques descartamos. Para el detalle técnico (endpoints, pairing, deploy, env vars) ver **`ARCHITECTURE.md`**.

## Git Workflow

**Branch de desarrollo activo: `dev`** — todos los cambios se commitean y pushean a `dev` salvo indicación
contraria (`git push origin dev`). Railway deploya `dev` automáticamente.

---

## Qué es Miru (producto real)

Recomendador conversacional de pelis/series. El foco es la **app móvil**:

1. El usuario baja la **app móvil**, le pide a Miru qué ver (**voz o texto**), y lo reproduce en la app
   de **streaming** que ya tiene (deep-link). Funciona solo con eso.
2. Si tiene la **app de TV**, toca **"Conectar TV"**, escanea el QR, y la **app móvil se vuelve control
   remoto** (la experiencia visual pasa a la TV).
3. Si llega a una TV con Miru y no quiere instalar la móvil, **escanea el QR** y la maneja desde la
   **web-control**.
4. Y si no quiere vincular nada: la TV abre **directo en el QR** y **cualquier flecha u OK del control
   físico entra al home** (sin selector previo) — home navegable con el D-pad, búsqueda con teclado en
   pantalla, Mi lista, Ya vistas, Abiertos y filtros de plataformas, todo local a la TV.

El AI es **Claude Haiku** (`claude-haiku-4-5-20251001`) vía un backend Node en Railway. Devuelve 1
recomendación principal + N alternativas, con refinamiento conversacional, feedback de gustos y voz (STT/TTS).

## La app móvil hoy: una conversación (decisión 2026-09)

> **EL MVP ES ESTO (decisión 2026-10).** Todo el trabajo va a la app conversacional (`apps/mobile`,
> `ChatScreen` y lo que usa) y al backend que la sirve. **El resto queda congelado como está**: TV
> (`public/tv-lite.html`, `apps/tv`, Tizen, webOS), `apps/web-control`, `wizard.tsx` / `?full=1`, la
> web legacy y la landing. No se les suman features ni se les hacen ajustes, salvo que se pida
> explícitamente o que un cambio del backend compartido los rompa.

Miru avanzó fuerte en producto (TV, control, grilla, tops) **sin validar el núcleo**. La app móvil vuelve
entonces a lo que era la idea: **hablarle y que te dé UNA película, bien justificada**, como el especialista
del videoclub. Todo lo demás **queda en el repo como capas** que se van a ir sumando si esto tracciona —
no se borró nada.

- Pantalla: **`apps/mobile/src/screens/ChatScreen.tsx`** (el hilo). `App.tsx` la renderiza por defecto;
  **`?full=1`** sigue levantando el `wizard.tsx` completo (grilla, galería, tops, Mi lista).
- Pide **`alternativesCount: 0`** a `/api/recommend` = modo conversación del motor: UNA película y
  `reason` largo (2-4 oraciones). Ver "Notas de desarrollo".
- Usa lo que el backend ya devolvía y la app tiraba: **`cinephile_note`** (intro hablada) y
  **`clarification_needed`** (repregunta cálida cuando dudás).
- **Composer a la manera de Claude** (`components/Composer.tsx`): texto arriba y abajo **[+]** · pastilla
  de plataformas ("Todas" o mini favicons) · **mic** (dicta al cuadro, NO envía) · **botón violeta**
  (modo voz con el cuadro vacío; "enviar" apenas hay texto). El **+** abre **"¿Dónde busco?"**
  (`PlatformSheet.tsx`): desde "Todas", tocar una deja SOLO esa; después suma/saca; sacar la última o
  marcar las 7 vuelve a "Todas" (`togglePlatformIn` en `lib/prefs.ts`). Queda guardada en
  `miru:platforms` (la misma que Mi cuenta). Favicons vía `faviconFor()`, con la inicial de la marca
  de respaldo (`PlatformIcon.tsx`).
- **Regla de voz: "habla si le hablaste"** — en el **modo voz** (`components/VoiceMode.tsx`) Miru
  escucha, **corta sola por silencio**, contesta hablado y vuelve a escuchar. Escrito o dictado →
  contesta escrito. La nota se muestra siempre. El modo voz busca la **sensación** del de Claude sin
  copiarlo: pantalla clara, la marca + frase grande en serif al centro ("Hablemos, Agus" / "Revisando tus plataformas…"), un **brillo violeta-lavanda que sube desde abajo y late con la voz**, el mic flotando
  (pausa/retoma/interrumpe; tocar la frase = "ya terminé") y abajo [+] · dónde busco · voz on/off · X.
  **Si Miru repregunta, la dice y sigue escuchando; si no, el modo voz se cierra solo y la ficha queda
  a la vista mientras Miru la cuenta hablando** (directo al resultado).
- **La marca** (`components/MiruMark.tsx`): un destello de 4 puntas violeta (el mismo ✦ del "por qué
  te la propongo") que reemplazó al orbe en la conversación —el orbe oscuro no hacía juego con el
  papel—. Como el asterisco de Claude, la marca ES el indicador de estado: respira (idle), crece con
  la voz (listening), gira (thinking), late (speaking); quieta en las burbujas viejas. El `Orb` sigue
  vivo solo en el wizard (`?full=1`).
- **Saludo a la manera de Claude**: la pantalla vacía es la marca + "Buenas tardes, Agustín" en serif
  grande (por la hora del teléfono) + una línea. El nombre sale de la **cuenta de Google** y viaja al
  motor como `userName` (lo nombra como mucho una vez por respuesta).
- **Cuenta** (`lib/auth.ts`, `LoginSheet.tsx`): login con **Google** (lo rápido) **o mail + contraseña**
  (crear cuenta con nombre, entrar, recuperar contraseña; errores de Supabase traducidos), vía **Supabase Auth** (mismo proyecto
  que el pairing, cliente aparte con sesión persistida en `miru:auth`, flujo PKCE). **Sin cuenta: 3
  recomendaciones de prueba** (`FREE_USES`; cuentan solo las que salieron bien, conteo local en
  `miru:free-uses`); en la 4ª, en vez de buscar, "Creá tu cuenta para seguir" → Continuar con Google, y
  lo pedido se guarda (`miru:pending-ask`) y se busca solo al volver. Con cuenta, sin límite; foto en el
  header y cuenta + Cerrar sesión en Mi cuenta. Configuración necesaria: cliente OAuth en Google Cloud
  (redirect `https://gyxooovdwputhznnlqhi.supabase.co/auth/v1/callback`) + provider Google en Supabase
  + Site/Redirect URLs. ⚠️ En el **APK** Google bloquea el OAuth dentro del WebView: hace falta otra
  configuración (pendiente).
- **La memoria vive en la cuenta** (`lib/tasteSync.ts` + tabla `public.miru_taste`, migración
  `supabase/migrations/20261003000000_miru_taste.sql`, RLS: cada uno lee/escribe solo su fila). La app
  sigue trabajando contra el localStorage (`miru:taste`, `miru:opened`, `miru:platforms`) y este módulo
  lo sincroniza: al entrar baja la memoria de la cuenta y la **fusiona** con la local (lo de la prueba
  sin cuenta pasa a la cuenta; si el teléfono tenía la de OTRA cuenta —`miru:taste-owner`— no se
  mezclan); cada cambio se sube solo (evento `miru:taste-changed`, 2.5 s de retraso); al cerrar sesión
  sube lo último y deja el teléfono limpio. Un pedido pendiente del login espera a que baje la memoria.
  Sin la tabla o sin red, todo sigue andando local.
- **Legales y borrar cuenta**: `/privacidad` y `/terminos` (`screens/LegalScreen.tsx`, ruteo por path en
  `App.tsx`) — los pide Google para publicar el login. Dicen lo que Miru REALMENTE hace con los datos
  (qué guarda, con qué servicios lo comparte): si eso cambia, se actualizan en el mismo cambio. Contacto
  `CONTACT_EMAIL` (`support@mirumovies.com`). **Borrar mi cuenta** en Mi cuenta llama a la
  función `delete_user()` de Supabase (migración 20260530021059); `miru_taste` se borra en cascada. Dominio:
  `www.mirumovies.com` (Railway, servicio de la web de la app; `mirumovies.com` redirige ahí desde GoDaddy). **Repregunta solo si amerita**: por defecto el motor va directo al
  resultado; un pedido corto con UNA señal ("algo de acción") no se repregunta.
- Descarte: el chip **"Dame otra"**; el resto se resuelve conversando (el historial viaja en `messages`).
- **La memoria del videoclub** (`lib/taste.ts`, `miru:taste`, sin DB): cada pedido, cada apertura, cada
  descarte **con lo que dijiste como motivo** (pedir otra cosa con una peli en pantalla que no abriste
  ES un descarte), la manito 👍/👎 de la ficha (reacción a la propuesta), **"Ya la vi"** (marca aparte que
  convive con la manito, etapa `seen`: saca el título de las propuestas sin vencimiento, salvo el toggle
  **"Incluir ya vistas"** del +, `miru:include-seen`) y el **"¿Qué tal estuvo X?"**
  al volver (veredicto después de verla, la señal más fuerte; una sola vez por título). Cada ~3 señales,
  `/api/profile` (`profile.mjs`) las sintetiza en un perfil de 50-90 palabras + tags + patrones, en
  segundo plano. Ese perfil viaja con cada pedido (`tasteProfile`) y el motor lo usa para elegir y para
  **nombrar UNA señal tuya** en la carta: el "cómo supo". `excludeTitles` es entre sesiones (30 días).
- **Motor en dos pasos** (`recommendSingle` en `recommend.mjs`): Haiku **propone 6 candidatos**
  rankeados (barato), **TMDB decide** cuál está en el país, y recién ahí Haiku **escribe la carta** para
  ese título. Nunca más "Ver en Netflix" de algo que no está. Ver "Notas de desarrollo".
- **El diferencial (principio de diseño del motor)**: contra "preguntarle a Claude/GPT", Miru gana por la
  recomendación **buena, inesperada y efectiva para CADA usuario**: sabe qué hay hoy en SUS plataformas,
  en SU país, qué acaba de llegar y qué le gustó. Las reglas se diseñan para el usuario en general, nunca
  para el gusto del equipo (lo que prueba Agustín es un caso, no el target). Está escrito al tope de
  `SYSTEM_PROPOSE`.
- **La sorpresa que buscamos** (decisión 2026-10): una producción de los **últimos ~4 años** que salió afuera, nunca estuvo en tu radar y **recién ahora llega a tu plataforma** en tu país. En `fresh.mjs` van marcadas "PRODUCCIÓN RECIENTE" y suben en el orden (más repercusión afuera = más arriba; lo solo indio queda afuera salvo que el pedido o el perfil muestren interés); el paso 1 pone una entre los 2 primeros si encaja, y la sorpresa de `pickWinner` (0.4) solo promueve esas.
- **Época**: por defecto la mayoría de los candidatos son de los últimos 10 años y como máximo uno anterior al 2000, salvo que pida algo viejo; los recién llegados de más de 20 años no entran salvo ese pedido. Lo inesperado se busca en otro país u otro tono, no décadas atrás.
- **Balance conocido / inesperado + recién llegados** (`fresh.mjs`, decisión 2026-10): no todos vieron
  todo (un conocido que encaja sigue valiendo), pero Miru vale por lo que la persona no encontraría sola
  en la portada de su plataforma. `fresh.mjs` lee el feed "Nuevo" de **JustWatch** (GraphQL no oficial;
  TMDB no sabe cuándo entró un título): lo que **acaba de llegar** a sus plataformas en su país, aunque la
  peli tenga años, 90 días, filtrado por plataformas/tipo/géneros del pedido. El paso 1 lo recibe y mete
  **1-2 entre los 6 si encajan**, en el lugar que les dé el encaje, más ≥2 menos obvios; si el perfil
  muestra varios "ya la había visto", sube la dosis de lo inesperado. En código, **sorpresa ~1/3**: si
  hay un recién llegado confirmado en el top 4, a veces gana ese. Es **criterio interno**: la carta y la
  ficha NO lo mencionan (`main.fresh` solo para métricas). Si JustWatch falla, todo sigue igual.
- **Mi cuenta** (`components/ProfileSheet.tsx`; el viejo `AccountSheet` queda solo para `?full=1`):
  quién sos (Entrar / Cerrar sesión) · **"Lo que Miru sabe de vos"** = la memoria visible y editable,
  como la de Claude: el resumen del perfil, tags "Te gusta"/"Evitás" que se sacan con una X
  (`removedTags`: no vuelven ni en la próxima síntesis), **"Lo que me pediste recordar"** (notas, se
  agregan a mano o desde la charla, se borran), un switch para **pausar la memoria** (`memoryOff`:
  `profileBlock()` devuelve null) y "Borrar la memoria" · historial (te gustaron / fuiste a ver /
  descartaste) · región · "Conectar la TV" (→ `ControlScreen`) · legales y Borrar mi cuenta. **No
  tiene plataformas ni "Ver luego"**: las plataformas se eligen por búsqueda, en el +.
- **"Acordate que…" en la charla**: SOLO si el último mensaje lo pide con palabras ("acordate",
  "recordá", "no te olvides"…; `askedToRemember()` en `recommend.mjs` lo exige en código), el paso 1
  devuelve en `remember` esa única cosa (3ª persona, corta). Las preferencias que no se pidieron
  recordar NO van a notas: las aprende la memoria general (perfil). Hasta 2026-10 se guardaban
  preferencias deducidas y resúmenes en cada turno: `purgeAutoNotes()` borra las notas de origen
  "chat" anteriores a ese arreglo (al abrir y al bajar la memoria de la cuenta). La app la guarda como
  nota (`addNote(…, "chat")`) y muestra "✓ Lo voy a recordar: … · Deshacer". Si el mensaje es SOLO eso
  (`only_remember`), el motor no busca película: vuelve `main: null` + `cinephile_note` = acuse, y la
  app lo muestra sin gastar un uso de prueba (en el modo voz, Miru lo dice y sigue escuchando). Las
  notas encabezan el `tasteProfile` ("respetalo SIEMPRE") y van a `/api/profile`.
- **Modos de búsqueda (las "habilidades") — APAGADOS por ahora** (`MODES_ENABLED = false` en `lib/prefs.ts`: sin sección en el +, sin chip, `mode` viaja null; el backend los sigue entendiendo): arriba del "¿Dónde busco?", **"¿Qué buscás?"** con 6
  modos (`MODES` en `lib/prefs.ts` y en `recommend.mjs`: Con chicos, Para dos, Algo corto, Maratón
  →serie, Cine de autor, Un clásico). Queda puesto (`miru:mode`) y se ve como chip en el composer
  hasta que lo sacás; viaja como `mode` y entra al prompt del paso 1 como regla dura.
- **Paywall (en diseño, sin código todavía)**: Mercado Pago, suscripción mensual (preapproval). Plan,
  decisiones, URLs, variables de entorno y la tarea para la CLI con el plugin de Mercado Pago:
  **`docs/PAYWALL.md`** — leerlo antes de tocar cobros.
- **Tema "Papel"** (claro, crema + tinta): la conversación es texto largo y UNA ficha, y ahí el negro
  puro cansaba y aplanaba los escalones fondo→burbuja→ficha. `index.css` define dos temas sobre los
  mismos tokens (`.theme-paper` / `.theme-dark`, + `--card` y `--accent`); `App.tsx` los pone en
  `<html>`. **Todo lo demás sigue oscuro**: `?full=1`, el control de TV (`theme-dark` en su raíz), la
  TV y la web legacy. El violeta es de Miru, el ocre es del "por qué", y el color de plataforma se usa
  SOLO en el botón "Ver en X" (con `textOnPlatform()`, porque el celeste de Prime con blanco no llega
  a AA).

## Los clientes (resumen — detalle en ARCHITECTURE.md)

| App | Qué es | Packaging |
|---|---|---|
| **`apps/mobile`** | La app principal. Hoy es **conversacional**: le pedís y te da UNA película (`ChatScreen`). El resto (grilla, tops, Mi lista, control de TV) sigue entero en `wizard.tsx`, detrás de `?full=1` | APK Capacitor, bundlea el front, `com.cinefilo.app` |
| **`apps/tv`** | App de TV = **cáscara WebView** que carga `public/tv-lite.html` (remoto) | APK Capacitor, `server.url`, `com.cinefilo.tv` |
| **`apps/tizen`** | App de Samsung Smart TV = **cáscara** que redirige a `public/tv-lite.html` (remoto). v1 sin deep-link nativo (fallback web) | `.wgt` FIRMADO (`build-wgt.ps1`), solo modo desarrollador (sin tienda Samsung) |
| **`apps/webos`** | App de LG webOS = **cáscara** gemela de la de Tizen (mismo redirect). Cubre LG + webOS Hub | `.ipk` SIN firma (`build-ipk.ps1`, CLI `@webosose/ares-cli`), modo desarrollador (expira a las ~50 h) |
| **`apps/web-control`** | Control web (D-pad) que abre el QR de la TV — **réplica del control remoto de la móvil**. Es el único control web vivo | Servicio Railway propio |
| **`src/` (web)** | Recomendador web (TanStack Start). **Legacy/secundaria** (incluido su `/control` viejo, que ya no abre el QR) | Sirve la web + el backend `/api/*` |
| **`apps/landing`** | Landing de descargas (QRs desde un manifest en Supabase) | Servicio Railway propio |

**Backend (raíz):** `server-node.mjs` rutea `/api/recommend`, `/api/intent`, `/api/orb`, `/api/ask`,
`/api/tv-home*`, `/api/tv-search`, `/api/transcribe`, `/api/tts`, `/api/ping`, y sirve la web SSR. Módulos
autónomos: `recommend.mjs`, `tv-search.mjs`, `transcribe.mjs`, `tts.mjs`.

**Plataformas (7):** Netflix, Disney+, Max, Prime Video, Apple TV+, Paramount+ y **Universal+**
(NBCUniversal LatAm: suscripción directa y app propia, y también como canal dentro de Prime — TMDB lo
lista aparte como "Universal+ Amazon Channel" y cuenta como Universal+). La lista está copiada en
varios lados: backend (`recommend.mjs`, `tv-search.mjs`, `PROVIDER_MAP` de `availability.mjs`), móvil
(`lib/prefs.ts`, que ahora es la ÚNICA del cliente), `public/tv-lite.html` y `apps/web-control`. De
Universal+ no tenemos verificados ni el `provider_id` de TMDB ni el `technicalName` de JustWatch: los
dos se resuelven **por nombre** en runtime (detalle en `ARCHITECTURE.md`). Ojo con las menciones en
texto libre: el "+"/"plus" es OBLIGATORIO en el regex — si no, "una peli de Universal" (el estudio)
filtraría la búsqueda a la plataforma.

**Pósters:** Cinemeta (Stremio) primero, iTunes + Wikipedia de fallback — en TODOS los clientes.

**Pairing TV↔control:** Supabase Realtime, canal `cinefilo:<sessionId>` (wire-legacy: NO renombrar
aunque la marca sea Miru), roles `tv`/`control`, protocolo en `tv-protocol.ts`. La sesión de la TV
persiste 30 días (`miru:tv:session`): el QR es estable entre recargas. ⚠️ El protocolo (+
`use-tv-channel.ts`, `stt.ts`) está copiado a mano en 4 lugares y ya divergió — cuidado al tocarlo.

**"Mi lista"** (ex "Para hoy"): una sola lista guardada por dispositivo — TV en `miru:tv:mylist`
(viaja al control como `SCREEN.myList`), móvil en `miru:mylist-items` + `miru:watchlist`. En el wire
sigue siendo `ADD_TODAY`/`todayTitles` (legacy, ver ARCHITECTURE.md).

---

## Enfoques descartados y por qué (NO revivir)

Miru pasó por varias versiones. Estos enfoques se **eliminaron del repo** (2026-07) — si aparecen en
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
  móvil. Se mantiene funcionando pero NO es el foco. (El backend `/api/*` que sirve ese mismo server SÍ es
  esencial.)
- **`/control` viejo** (`src/routes/control.tsx`, lista scrolleable + FOCUS): superado por `apps/web-control`
  (D-pad, réplica del control móvil). El QR de la TV ya apunta a la web-control, así que esta ruta quedó
  huérfana — no agregarle features; si algo falta, va en `apps/web-control`.
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
   micrófonos son **press-to-speak / press-to-stop**, con UNA excepción: el **modo voz** de la app móvil
   (`VoiceMode.tsx`), que corta solo por silencio (1.4 s) para que la charla fluya como en Claude.
4. **Build APK (móvil/TV):** desde el checkout PRINCIPAL (`apps/mobile` o `apps/tv`), `JAVA_HOME` seteado,
   `./gradlew.bat clean assembleDebug` (gotcha: NO `cmd.exe /c "gradlew.bat"` — no ejecuta gradle). Verificar
   el mtime del APK antes de instalar. Detalle en `ARCHITECTURE.md` y en las memorias del proyecto.
5. **Watchlist / "Mi lista":** `localStorage` con claves `miru:*` (las viejas `cinefilo:*`/`queveo:*`
   se migran al boot de cada cliente), no DB.
6. **Actualizar la TV sin rebuild:** editar `public/tv-lite.html` + redeployar el backend → el APK de TV ya
   instalado muestra la versión nueva (carga la URL remota).
7. **TV = un solo banner que sigue al foco + grilla completa** (revisión con Carlos, 2026-09): el
   banner es la ficha de la tarjeta enfocada (no un carrusel); todos los resultados van en la grilla
   desde el primero, 6 por fila, tarjetas solo imagen. El **banner manda en la pantalla** (56vh, sin
   borde ni esquinas, sangra a los bordes y se funde con el fondo por gradiente; usa la imagen
   HORIZONTAL del título — `backdropUrl`, backdrop de TMDB — y cae al póster acotado a la derecha si
   no la hay): la primera fila de tarjetas ASOMA abajo, como en Prime. Los textos los pide la TV a
   `/api/tv-blurb` bajo demanda, nunca la búsqueda: **una frase** (`blurb`) para el título del banner,
   y **sinopsis + porqué** (`full: true`) al abrir una ficha — como la frase ya está en pantalla, la
   ficha nunca espera en blanco. Ítems `avail:
   "unknown"` se muestran "Por confirmar en X". Detalle en `ARCHITECTURE.md` §3.B.
8. **"Abiertos recientemente"** (móvil `miru:opened`, TV `miru:tv:opened`): registro local de cada
   "Ver en X" para volver a abrirlo. NO es "Continuar viendo": no hay progreso real ni se captura lo
   visto fuera de Miru.
9. **Modo conversación del motor** (`recommend.mjs`, `alternativesCount: 0`): **propone → verifica →
   pitchea**. Paso 1 (`SYSTEM_PROPOSE`, ~700 tokens): 6 candidatos rankeados por encaje con el pedido y
   el perfil (3 al centro, 2 que abren, 1 apuesta), solo título/plataforma/año/línea, más
   `clarification_needed` si el pedido es vago o hay 2 descartes secos seguidos. TMDB valida los 6; gana
   el primero confirmado (después, el primero `unknown`); si ninguno está, UN reintento con esos
   excluidos. Paso 2 (`SYSTEM_PITCH`): synopsis + `reason` de 45-75 palabras + intro hablada para el
   título ya confirmado, con la regla de **nombrar UNA señal** del perfil/charla cuando influyó (nunca
   inventada, nunca más de una). Si la carta falla, la peli sale igual con la línea del paso 1. Entradas
   nuevas: `tasteProfile` (texto) y `rejected` (descartes de la charla con motivo). Log
   `[metrics-single]`. `alternativesCount >= 1` sigue exactamente como siempre: de eso viven la TV y
   `?full=1`.
10. **Home sin búsqueda = banner + tiras "Top 6 en X"** (TV y móvil): catálogo por
   plataforma desde `/api/tv-home` (`rows`) / `/api/top-platforms`, ranking TMDB por plataforma
   (`byPlatform` en `availability.mjs` — NO es el top oficial de cada plataforma, no hay API
   pública de eso), numerado 1-10. Las plataformas del usuario van primero, el resto atenuado.
   Los tops NO llevan "por qué te la propongo" (están por ranking, no por sugerencia). En la TV
   son estado propio (`topRows`/`rowFocus`), aditivo sobre `items` — "Más opciones para vos" y el
   scroll infinito siguen igual debajo. La tira "Mi lista" NO vive en el home (acceso: tab del
   menú en RC, botón del control en vinculado, desplegable comprimido en el móvil).
11. **Web touch (tablets/laptops):** `tv-lite.html?touch=1` = la misma UI del modo RC pero
   clickeable (listener de click delegado + botón ‹ Volver flotante + scroll táctil de tiras;
   arranca directo en el contenido). Entrada: la URL de la web-control SIN `?session=` redirige
   ahí; con `?session=` sigue siendo el control del QR.

Detalle completo de arquitectura, endpoints, pairing, deploy y env vars: **`ARCHITECTURE.md`**.
