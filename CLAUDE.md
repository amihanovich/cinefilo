# Cinéfilo — Documentación completa del proyecto

## Git Workflow

**Branch de desarrollo activo: `dev`**
- Todos los cambios se commitean y pushean a `dev` salvo indicación contraria
- `git push -u origin dev`

---

## Qué es Cinéfilo

Cinéfilo es una app fullstack que recomienda películas y series de forma conversacional. El usuario describe qué quiere ver (texto o voz), la app llama a un modelo de lenguaje (Claude Haiku) y devuelve 1 recomendación principal + 4 alternativas. El usuario puede refinar los resultados sin salir de la pantalla, marcar lo que ya vio, guardar en una lista personal, y explorar su historial de gustos.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Framework fullstack | TanStack Start (React SSR + file-based routing) |
| UI | React 19 + TailwindCSS 4 + Radix UI (sin estilos) |
| Iconos | Lucide React |
| Carouseles | Embla Carousel |
| Formularios | React Hook Form + Zod |
| Estado del servidor | TanStack Query (React Query) |
| Base de datos + auth | Supabase (PostgreSQL + RLS + Realtime) |
| Integraciones AI | Vercel AI SDK (`generateText`) |
| Modelo AI | `claude-haiku-4-5-20251001` (todas las llamadas de producción) |
| Notificaciones toast | Sonner |
| Deployment | Railway (Node.js adapter, no Cloudflare) |
| Build | Vite + NIXPACKS |

---

## Estructura de archivos clave

```
cinefilo/
├── src/
│   ├── routes/
│   │   ├── __root.tsx                  # Root layout (Toaster, etc.)
│   │   ├── _authenticated.tsx          # Layout protegido: header (logo + avatar + AccountSheet)
│   │   ├── _authenticated/
│   │   │   └── index.tsx               # Pantalla principal: home + resultados
│   │   ├── login.tsx                   # Pantalla de login
│   │   └── reset-password.tsx
│   ├── components/
│   │   ├── AccountSheet.tsx            # Sheet lateral "Mi cuenta" (stats, galería de gustos)
│   │   ├── MicButton.tsx               # Botón de dictado por voz (Web Speech API)
│   │   ├── PosterMarquee.tsx           # Banda de posters en la home (marquee animado)
│   │   ├── PlatformLogo.tsx            # Logo de plataforma (Netflix, Disney+, etc.)
│   │   ├── PlatformOrbit.tsx           # Orbita decorativa de logos de plataformas
│   │   ├── VoiceOrb.tsx                # Orb animado de voz (decorativo)
│   │   ├── Onboarding.tsx              # Onboarding de primer uso
│   │   ├── MatchOverlay.tsx            # Overlay de "match" al recomendar (animación)
│   │   ├── SocialMatchOverlay.tsx      # Overlay cuando hay match social (Modo Social)
│   │   ├── SocialModeToggle.tsx        # Toggle del Modo Social en la home
│   │   ├── NearbyUsersStrip.tsx        # Banda de usuarios cercanos (Modo Social)
│   │   ├── SwipeCardDeck.tsx           # Deck de tarjetas swipe (legacy, no en uso activo)
│   │   └── ui/                         # Componentes Radix/shadcn (Button, Dialog, Sheet, etc.)
│   ├── lib/
│   │   ├── recommendations.ts          # Tipos: Platform, Recommendation, RecommendationsResult, SituationFilters
│   │   ├── recommendations.functions.ts # Server fns AI: recommendConversational, chooseFromLiked, trending
│   │   ├── feedback.functions.ts       # Server fns DB: recordTitleFeedback, getTitlesBySentiment, resetTitleFeedback
│   │   ├── profile.functions.ts        # Server fns: getProfile, setDefaultPlatforms, updateProfile
│   │   ├── social.functions.ts         # Server fns: upsertPresence, findNearbyMatch, removePresence
│   │   ├── posters.functions.ts        # Server fn: busca posters via iTunes API (server-side)
│   │   ├── trending.functions.ts       # Server fn: getTrending (para marquee inicial)
│   │   ├── itunes.ts                   # fetchPostersClient: busca posters iTunes desde el cliente
│   │   ├── environment.ts             # Clima (geolocalización + Open-Meteo), weatherHintShort
│   │   ├── context.ts                  # inferContext: hora, día, temporada → hint para el prompt
│   │   ├── suggestions.ts             # getContextualSuggestions: sugerencias de búsqueda contextuales
│   │   ├── recentSearches.ts          # readRecentSearches / pushRecentSearch (localStorage)
│   │   ├── guestSeed.ts               # Estado de usuario invitado (búsquedas sin login)
│   │   ├── posterCache.ts             # Cache de posters en memoria
│   │   ├── personality.ts             # buildPersonalityHint: inyecta historial de gustos en prompt
│   │   ├── auth-optional.ts           # getOptionalUser: obtiene user+supabase client en server fns
│   │   ├── ai-gateway.ts              # Configuración del modelo AI (Vercel AI SDK)
│   │   ├── error-capture.ts
│   │   └── utils.ts                   # cn(), helpers
│   └── integrations/
│       └── supabase/
│           ├── client.ts               # supabase: SupabaseClient (cliente browser)
│           └── types.ts                # Tipos generados de la DB
├── supabase/
│   └── migrations/                     # Migraciones SQL históricas
├── vite.config.ts
├── tsconfig.json
├── nixpacks.toml
├── railway.json
└── DEPLOYMENT.md
```

---

## Flujo de la app (desde el punto de vista del usuario)

### 1. Home screen

El usuario llega a `/`. Ve:
- Un marquee horizontal con posters de películas populares (via `PosterMarquee` + `getTrending`)
- Un campo de búsqueda de texto libre con sugerencias contextuales y búsquedas recientes
- Un botón de micrófono (`MicButton`) para dictar por voz
- Filtros opcionales: plataforma, estado de ánimo, compañía, tiempo disponible, atención

Si es un usuario invitado (sin login), después de N búsquedas se muestra un "nudge" para registrarse.

### 2. Resultados

Al enviar la búsqueda, `submit()` llama `recommendConversational` (server fn que llama al modelo AI con el contexto del usuario). La respuesta llega como JSON con:
- `main`: recomendación principal (`title`, `platform`, `duration`, `type`, `reason`)
- `alternatives`: array de hasta 4 alternativas

La pantalla cambia a "results":
- **Tarjeta principal**: poster grande (148px), título, plataforma con color de badge, razón de la recomendación, botones "Ver ahora" (deep link a la plataforma) + "Tráiler" (YouTube search)
- **Carrusel de alternativas**: scroll horizontal, tarjetas más chicas (poster 110px)
- Cada tarjeta tiene acciones: `👁 Ya la vi`, `🔖 Guardar`, `👎 No me gusta`
- **Barra de refinamiento** abajo: campo de texto + mic para afinar la búsqueda sin volver a la home. Cada refinamiento agrega contexto al historial de conversación (`searchHistory`)

### 3. Acciones de feedback

Cuando el usuario marca una tarjeta:
- **Ya la vi / No me gusta**: llama `recordTitleFeedback` (guarda en `title_feedback` con sentiment `seen` / `dislike`), agrega el título a `excluded` para que no vuelva a aparecer
- **Guardar**: guarda en `localStorage` (no en DB, es una lista personal efímera)
- Las tarjetas marcadas quedan en 40% opacidad

### 4. Mi cuenta (AccountSheet)

Panel lateral con:
- Email del usuario
- Plataformas predeterminadas (multiselect, guardado en `profiles.default_platforms`)
- Stats de actividad: cuántos títulos tienen cada sentiment (Me encantó ❤️, Me gustó 👍, Ya la vi 👁, No me gustó 👎)
- Cliqueando un stat card (si el número > 0) se abre una **galería de gustos**: grid 2 columnas con poster, título, plataforma y link "Ver en [plataforma]"
- Opción para resetear el historial de preferencias

---

## AI — Server functions

### `recommendConversational` (`src/lib/recommendations.functions.ts`)

Función principal de recomendación. Recibe:
- `query`: texto libre del usuario
- `history`: conversación previa (para refinamientos)
- `filters`: plataformas, tiempo, compañía, estado de ánimo, etc.
- `excluded`: títulos a ignorar
- `seed`: info del usuario invitado (búsquedas previas, plataformas)

Construye un prompt con:
- Contexto temporal (hora, día, temporada vía `inferContext`)
- Clima (vía `weatherHintShort`)
- Historial de gustos del usuario (vía `getTasteSnapshot`)
- Filtros de situación
- Títulos excluidos

Devuelve JSON: `{ filters, main: Recommendation, alternatives: Recommendation[] }`

**Modelo**: `claude-haiku-4-5-20251001` | `maxOutputTokens: 800`

### `chooseFromLiked` (`src/lib/recommendations.functions.ts`)

Flujo socrático para elegir entre títulos que el usuario likeó durante un swipe. El AI hace preguntas para afinar la recomendación. Cuando tiene suficiente info, termina su respuesta con `ELIGE: [título exacto]` en una línea separada. El server fn parsea ese tag y lo devuelve como `{ text, finalTitle? }`.

### `recordTitleFeedback` / `getTitlesBySentiment` / `resetTitleFeedback` (`src/lib/feedback.functions.ts`)

CRUD de la tabla `title_feedback`.
- `recordTitleFeedback`: inserta un registro (idempotente via unique_violation 23505)
- `getTitlesBySentiment`: devuelve los últimos 200 títulos de un sentiment para la galería
- `resetTitleFeedback`: borra historial con scope `all | preferences | seen`

---

## Base de datos (Supabase)

### Tablas principales

**`profiles`**
```sql
user_id UUID PRIMARY KEY (= auth.users.id)
default_platforms TEXT[]     -- plataformas preferidas del usuario
display_name TEXT            -- nombre visible en Modo Social
avatar_color TEXT            -- color de avatar (#hex)
```

**`title_feedback`**
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES auth.users
title TEXT
platform TEXT
sentiment TEXT  -- 'love' | 'like' | 'dislike' | 'seen'
created_at TIMESTAMPTZ
UNIQUE(user_id, title, sentiment)
```

**`user_presence`** *(Modo Social — opt-in)*
```sql
user_id UUID PRIMARY KEY
lat FLOAT, lng FLOAT         -- coordenadas a 2 decimales (~1km radio)
display_name TEXT
avatar_color TEXT
is_visible BOOLEAN
last_seen TIMESTAMPTZ
mood_filter TEXT, company_filter TEXT, attention_filter TEXT, type_filter TEXT
```

**`social_matches`** *(Modo Social)*
```sql
id UUID PRIMARY KEY
user_a UUID, user_b UUID     -- par de usuarios que coincidieron
title TEXT, platform TEXT
matched_at TIMESTAMPTZ
UNIQUE(user_a, user_b, title)
```
Realtime habilitado en esta tabla: permite notificaciones push cuando alguien cerca likeó lo mismo.

---

## Modo Social (feature opt-in)

El usuario activa "Modo Social" desde la home. Esto:
1. Pide permiso de geolocalización
2. Llama `upsertPresence` para registrarse como visible
3. Suscribe a Supabase Realtime en `social_matches` (filter: `user_b = mi user_id`)
4. Al hacer like en un swipe → llama `findNearbyMatch` → si hay match → muestra `SocialMatchOverlay`
5. Al desactivar → llama `removePresence` → cancela la suscripción

El match usa bounding box simple: `ABS(lat - user_lat) < 0.09 AND ABS(lng - user_lng) < 0.09` (~10km radio). Sin PostGIS.

---

## Posters

Los posters se obtienen de la **API de iTunes** (no requiere auth, gratuita):
```
https://itunes.apple.com/search?term={título}&media=movie&limit=1
```

- **Client-side**: `fetchPostersClient` en `src/lib/itunes.ts` — llamadas directas desde el browser
- **Server-side**: `posters.functions.ts` — usado cuando el rendering es SSR
- Cache en memoria: `posterCache.ts`

---

## Autenticación

- Supabase Auth (email + password)
- `getOptionalUser()` (`src/lib/auth-optional.ts`): helper para server fns — devuelve `{ userId, supabase }` o `null` si es invitado
- Usuarios invitados pueden buscar (N veces) antes de ser empujados al login
- `guestSeed.ts`: trackea búsquedas de invitados en localStorage

---

## Environment / contexto contextual

- **Hora y temporada**: `inferContext()` en `context.ts` — devuelve si es noche, fin de semana, invierno, etc.
- **Clima**: `environment.ts` — llama Open-Meteo con lat/lng del usuario → `weatherHintShort()` devuelve una frase corta para el prompt ("lluvioso y frío")
- **Sugerencias**: `getContextualSuggestions()` en `suggestions.ts` — sugerencias de texto según contexto

---

## Plataformas soportadas

`Netflix | Disney+ | Max | Prime Video | Apple TV+ | Paramount+ | Star+`

Cada plataforma tiene:
- Color de badge (`colorForPlatform`)
- Deep link de apertura (`deepLinkFor`) — p.ej. `https://www.netflix.com/search?q={título}`
- Logo SVG (`PlatformLogo`)

---

## Scripts de desarrollo

```bash
npm run dev          # Dev server con hot reload
npm run build        # Build de producción → .output/
npm run build:dev    # Build en modo dev
npm run preview      # Preview del build
npm start            # Servidor de producción
npm run lint         # ESLint
npm run format       # Prettier
```

Instalar dependencias: `npm install --legacy-peer-deps`

---

## Variables de entorno

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
ANTHROPIC_API_KEY=<clave>         # o la variable que usa el AI gateway
```

---

## Deployment

- **Plataforma**: Railway
- **Build**: NIXPACKS (configurado en `nixpacks.toml`)
- **Branch activo en Railway**: `dev`
- **Adapter**: Node.js (`cloudflare: false` en vite.config.ts)
- Output: `.output/server/` + `.output/client/`

Ver `DEPLOYMENT.md` para el checklist completo.

---

## Notas de desarrollo importantes

1. **No usar `any` en TypeScript** — Zod valida en runtime en todos los server fns
2. **Modelo AI**: siempre `claude-haiku-4-5-20251001` en producción. No bajar `maxOutputTokens` de 800 (el JSON de recomendaciones puede truncarse)
3. **`getTitlesBySentiment`**: `love` = Me encantó, `like` = Me gustó, `dislike` = No me gustó, `seen` = Ya la vi
4. **Watchlist**: guardada en `localStorage` (`queveo:watchlist`), no en Supabase
5. **Swipe / choose mode**: `SwipeCardDeck` y `chooseFromLiked` existen pero no están activos en el flujo principal actual. La pantalla de resultados reemplazó ese flujo
6. **Refinamiento**: cada búsqueda adicional desde la barra inferior agrega un mensaje al array `searchHistory`, que se pasa como `history` a `recommendConversational` para mantener contexto
