# Deployment — Cinéfilo en Railway

Detalle de arquitectura completo en **`ARCHITECTURE.md`**; resumen de producto en `CLAUDE.md`. Este archivo
es solo el checklist de deploy.

## Servicios (Railway, NIXPACKS, Node 22)

Son **servicios independientes**, todos con `npm install --legacy-peer-deps` + build Vite:

| Servicio | Config | Build | Start | Dominio |
|---|---|---|---|---|
| **Backend + web** | raíz `railway.json` / `nixpacks.toml` | `npm run build` (Vite → `dist/`) | **`node server-node.mjs`** | `cinefilo-production.up.railway.app` |
| **web-control** | `apps/web-control/` | `npm run build` | `node server.mjs` | `cinefilo-copy-production.up.railway.app` |
| **landing** | `apps/landing/` | `npm run build` | `node server.mjs` | (servicio propio) |

- **Branch conectado: `dev`** — deploy automático al push. Restart `ON_FAILURE`, máx 3 reintentos.
- Las apps **Capacitor (móvil, TV) NO se deployan en Railway**: se compilan a APK (`npm run apk`) y se
  distribuyen por la landing/manifest.
- ⚠️ El start real del backend es **`server-node.mjs`** (servidor Node nativo), NO `.output/server/index.mjs`.

## Variables de entorno (servicio backend + web)

```
# AI + voz
ANTHROPIC_API_KEY=<clave>
ELEVENLABS_API_KEY=<clave>        # TTS (opcional ELEVENLABS_VOICE_ID)
GROQ_API_KEY=<clave>              # STT (Whisper)

# Supabase
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role>   # solo server
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

`PORT` lo inyecta Railway. Env vars de web-control / landing / apps: ver `ARCHITECTURE.md` §8.

## Troubleshooting

- **Build falla:** verificar que `npm install --legacy-peer-deps && npm run build` corre localmente; ver logs.
- **Server no inicia:** confirmar env vars; el start es `node server-node.mjs`.
- **Sin pósters:** Cinemeta (Stremio) es la fuente principal; ver §5 de `ARCHITECTURE.md`.
- **TV desactualizada:** editar `public/tv-lite.html` + redeploy → el APK de TV (cáscara) muestra la nueva
  versión sin rebuild.
