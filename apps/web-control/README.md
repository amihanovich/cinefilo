# Cinéfilo Web-Control

Réplica web del control remoto de la TV, en el tema oscuro de la app nueva y en
un proyecto/dominio propio (separado del `/control` original de Railway).

Cuando escaneás el QR de **Cinéfilo TV**, se abre esta web:
`https://<tu-dominio>/?session=<id>`. Desde ahí buscás (texto o voz), navegás la
lista deslizando (se resalta en la TV en vivo) y reproducís — igual que la app
móvil, pero sin instalar nada.

La voz acá es **solo dictado de búsqueda**. El agente conversacional Cinéfilo
(hablar, preguntar sobre una peli) es exclusivo de la app móvil: por eso hay un
CTA fijo arriba para descargarla.

## Desarrollo

```bash
cd apps/web-control
npm install --legacy-peer-deps
npm run dev
# probá con http://localhost:5173/?session=<id-de-una-TV-emparejada>
```

## Build + servir

```bash
npm run build      # genera dist/
npm start          # sirve dist/ con server.mjs (SPA fallback) en $PORT
```

## Deploy en Railway (servicio aparte)

1. New Project → Deploy from repo → elegí este repo.
2. En **Settings → Root Directory** del servicio, poné `apps/web-control`.
   Railway toma `nixpacks.toml` + `railway.json` de esta carpeta:
   build `npm run build`, start `node server.mjs`.
3. Configurá el dominio propio en **Settings → Networking → Custom Domain**.
4. (Opcional) Variables de entorno — ver `.env.example`. Sin ninguna, funciona
   igual (usa el backend de Railway existente y la publishable key por defecto).

## Repuntar el QR de la TV a este dominio

En el build de la app de TV (`apps/tv`), seteá:

```
VITE_CONTROL_BASE_URL=https://<tu-dominio>
```

El QR pasa a apuntar a `https://<tu-dominio>/control?session=<id>`. Esta web
acepta tanto `/?session=` como `/control?session=` (mismo SPA), así que el link
funciona en las dos formas.
