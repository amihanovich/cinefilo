# Miru — Wizard Experience

Experimento de validación de hipótesis: *"El usuario sabe qué hacer desde el segundo 1 y completa el wizard en menos de 60 segundos."*

---

## Rutas involucradas

| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/wizard` | `src/routes/wizard.tsx` | Teléfono: wizard + magic moment + agente |
| `/tv` | `src/routes/tv.tsx` | TV: pantalla fullscreen sincronizada |

Ambas rutas son públicas (sin auth).

---

## Flujo del wizard (teléfono)

### Pantalla 1 — Bienvenida
Pantalla de entrada. Botón "Empezar" avanza a la pantalla de TV.

### Pantalla 2 — Conectar TV (simulado)
Simula un picker de dispositivos Cast:
1. Spinner "Buscando en la red..." (1.4 s)
2. Aparece la tarjeta "📺 Philips 65PUD7906/77 — Disponible"
3. Al tocarla: "Conectando..." (1.2 s) → "Conectado ✓" → avanza solo
4. Botón "Sin TV → Seguir igual" para saltear (setea `withTV = false`)

Al conectar setea `withTV = true` y `tvConnected = true`. No hay handshake real de Cast; la sincronización se hace via Supabase Realtime (ver más abajo).

### Pantalla 3 — Plataformas
Grid 3 columnas con las 7 plataformas disponibles. Multi-select toggle. Si no se elige ninguna, se usan todas. Botón "Continuar →" avanza a Mood.

**Plataformas:** Netflix · Disney+ · Max · Prime Video · Apple TV+ · Paramount+ · Star+

### Pantalla 4 — Mood
6 botones de mood rápido. Al tocar uno llama directamente a `getReco(query)` y avanza al Magic Moment.

| Botón | Query enviado al agente |
|-------|------------------------|
| Reírme 😂 | "una comedia para reírme" |
| Sorprenderme 😮 | "algo que me sorprenda" |
| Emocionarme 😢 | "algo para emocionarme" |
| Suspenso 😱 | "algo de suspenso" |
| Aprender 🧠 | "algo para aprender" |
| Lo que sea 🎬 | "lo mejor para esta noche" |

### Pantalla 5 — Magic Moment
Layout de tres zonas:

```
┌─────────────────────────────┐
│ ✦ Miru      📺 TV en vivo│  header
├─────────────────────────────┤
│  AGENTE CINÉFILO            │
│  [🎤 orb grande] [input →] │  agente (top, prominente)
├─────────────────────────────┤
│  ┌─────┬──────────────────┐ │
│  │poster│ Título           │ │  mini hero (h-44, swipeable)
│  │      │ Plataforma·Tipo  │ │
│  │      │ Año · +13        │ │
│  │      │ Razón...         │ │
│  │      │ [▶ Ver ahora]   │ │
│  └─────┴──────────────────┘ │
│  [burbuja agente si aplica] │  reply del agente
├─────────────────────────────┤
│  CONTROLAR LA TV            │
│  [◄ Anterior] 1/5 [Siguiente►]│  nav TV
└─────────────────────────────┘
```

---

## Agente Miru — Intents

El campo de texto y el micrófono detectan automáticamente el intent y rutean a la función correcta:

### Intent 1: Nueva búsqueda / refinamiento → `getReco(query)`
Cualquier mensaje que no sea una pregunta sobre el título actual:
- "Algo más oscuro"
- "Quiero acción"
- "Dame algo con Villeneuve"
- "Más opciones"
- "Una comedia"

Resultado: nuevo set de 5 recomendaciones, la TV se actualiza.

### Intent 2: Detalles del título seleccionado → `askAbout(query)`
Detectado por regex en `isDetailQuery()`. Triggers:
- "contame", "explicame", "por qué", "de qué trata"
- "sinopsis", "argumento", "director", "reparto"
- "vale la pena", "quién", "cuándo", "más info"
- "opinión", "estilo", "temática"

Resultado: burbuja de respuesta debajo de la mini hero. La TV no cambia.
El agente recibe historial de los intercambios anteriores de la misma sesión para variar las frases de apertura ("Y esta otra...", "En cambio acá...").

### Micrófono
- **Tap** → activa, escucha
- **2.2 s de silencio** → para y envía (`continuous: true` + silence timer)
- **Tap de nuevo** → para manualmente
- Cap de seguridad: 12 s sin hablar

---

## Sincronización Teléfono ↔ TV

Usa **Supabase Realtime** (broadcast channel). Session ID fijo: `"cinefilo-test"`.
Canal: `cinefilo:session:cinefilo-test`.

### Mensajes que envía el teléfono

```typescript
// Al recibir recomendaciones
{ type: "results", items: Recommendation[], posters: Record<string, string|null>, selectedIndex: 0 }

// Al navegar entre items
{ type: "select", index: number }
```

### Mensajes que escucha el teléfono

```
tv_ready  →  setTvConnected(true)
```

La TV envía `tv_ready` al conectarse al canal. El wizard envía `wizard_ping` cada 2 s mientras espera; la TV responde con `tv_ready`. Esto maneja ambos casos de timing (TV conectada antes o después del wizard).

---

## Layout de la TV (`/tv`)

```
┌────────────────────────────────────────────┐
│ ✦ Miru              ●●●●● (dots)        │  70% alto
│                                             │
│ [poster de fondo, full bleed]               │
│ gradient oscuro sobre la imagen             │
│                                             │
│  Netflix · Película · 2019                  │
│  TÍTULO GRANDE EN BLANCO                    │
│  Razón de la recomendación...               │
├────────────────────────────────────────────┤
│  Más opciones                               │  30% alto
│  [card1] [card2] [card3] [card4] [card5]   │
│   activa con ring blanco + escala           │
└────────────────────────────────────────────┘
```

La TV reacciona a los mensajes `results` (carga todo) y `select` (cambia el hero y el active en el strip).

---

## Posters

Fetching **server-side** via `fetchPosters` (`src/lib/posters.functions.ts`).

Estrategia por título:
1. iTunes: 5 tiendas en paralelo (US movie, AR movie, US tvShow, AR tvShow, ES movie)
2. Strip de artículo + reintentos si Round 1 falla
3. Wikipedia (en + es) como fallback final

La pantalla magic aparece inmediatamente después de que el AI responde. Los posters se cargan en background y se muestran con skeleton animado mientras llegan.

---

## Server Functions involucradas

| Función | Archivo | Uso |
|---------|---------|-----|
| `recommendConversational` | `recommendations.functions.ts` | Genera 1 main + 4 alternatives con historial de conversación |
| `askAboutTitle` | `recommendations.functions.ts` | Responde preguntas sobre el título seleccionado (2 oraciones max) |
| `fetchPosters` | `posters.functions.ts` | Busca posters server-side (iTunes + Wikipedia) |

Modelo AI usado: `claude-haiku-4-5-20251001` en todas las llamadas.

---

## Estado local del wizard

```typescript
screen: "welcome" | "tv" | "platforms" | "mood" | "magic"
withTV: boolean           // false si el usuario saltea la TV
tvConnected: boolean      // true cuando la TV responde tv_ready
platforms: string[]       // plataformas seleccionadas (vacío = todas)
items: Recommendation[]   // 5 items: [main, ...alternatives]
posters: Record<string, string|null>
currentIndex: number      // 0-4
messages: { role, content }[]  // historial conversacional para el AI
agentReply: string|null   // respuesta del agente sobre el título actual
detailHistory: { title, question, answer }[]  // historial de detalles para contexto
```

---

## Archivos modificados / creados en este experimento

```
src/routes/wizard.tsx          — wizard completo (nuevo)
src/routes/tv.tsx              — pantalla TV actualizada
src/components/MicButton.tsx   — modo continuous con silence detection
src/lib/posters.functions.ts   — refactor + Wikipedia fallback
src/lib/recommendations.functions.ts  — askAboutTitle (nuevo)
src/routeTree.gen.ts           — /wizard agregado
```
