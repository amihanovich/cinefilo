# Cinéfilo — Landing de descargas

Landing page standalone (HTML/CSS + servidor Node sin dependencias) con los
accesos para descargar la app de Cinéfilo en móvil y en TV. Es un proyecto
independiente del fullstack principal, pensado para desplegarse como su
propio servicio en Railway.

## Correr localmente

```bash
cd landing
npm start
```

Se sirve en `http://localhost:3000`.

## Estructura

```
landing/
├── index.html         # Landing (hero + tarjetas de descarga)
├── styles.css          # Estilos, alineados a la paleta de la app principal
├── server.js            # Servidor estático + rutas fijas de descarga de APK
├── downloads/            # APK publicados (ver downloads/README.md)
├── railway.json           # Config de deploy
└── nixpacks.toml           # Build config para Railway
```

## Descargas de APK con link estable

`server.js` expone dos rutas fijas que siempre sirven la última versión
subida a `downloads/`, sin importar el nombre de archivo original:

- `/download/android` → `downloads/cinefilo-mobile.apk`
- `/download/androidtv` → `downloads/cinefilo-tv.apk`

Para publicar una versión nueva, reemplazá el archivo (mismo nombre) y
pusheá — el link público no cambia. Más detalle en `downloads/README.md`.

## Deploy en Railway (servicio separado, mismo repo)

1. Railway → **New Project** → **Deploy from GitHub repo** → `amihanovich/cinefilo`.
2. En **Settings → Root Directory**, poné `landing`.
3. Railway detecta `nixpacks.toml` y `railway.json` de esta carpeta automáticamente.
4. (Opcional) Asignar un dominio propio, por ejemplo `descargar.cinefilo.app`.

No requiere variables de entorno ni base de datos: es una página estática.

## Activar los botones cuando haya links/APK reales

Los cuatro botones (App Store, Google Play, Apple TV, Android TV) arrancan
en estado "Próximamente" (`class="store-button is-disabled"` en `index.html`).
Para activarlos:

- **iOS / Apple TV**: reemplazá el `href="#"` por la URL real de la store y
  sacá la clase `is-disabled`.
- **Android / Android TV**: ya apuntan a `/download/android` y
  `/download/androidtv`. Solo hace falta subir el APK correspondiente a
  `downloads/` y sacar la clase `is-disabled`.
