# Miru — app de Samsung Smart TV (Tizen)

Cáscara para Samsung Tizen, equivalente a `apps/tv` (Android) pero para Tizen: **no bundlea nada
propio**, solo carga remoto `public/tv-lite.html` (servida por el backend en Railway). Por eso
`apps/tizen/index.html` no tiene lógica salvo un redirect — toda la app de verdad vive en
`tv-lite.html` y se actualiza sola con cada redeploy del backend, **sin reempaquetar el `.wgt`**
(igual que la app de Android no necesita rebuild cuando solo cambia `tv-lite.html`).

**v1: sin deep-link nativo a Netflix/Prime/etc.** — "Ver ahora" abre la web de la plataforma en vez
de la app nativa de Samsung (los IDs internos de Tizen de cada app no son públicos y hace falta
confirmarlos en un TV real; queda para una v2). Ver `ARCHITECTURE.md` para el resto del contexto.

## Setup — primera vez (una sola vez por máquina)

1. **Instalar Tizen Studio**: [developer.tizen.org/development/tizen-studio](https://developer.tizen.org/development/tizen-studio/download).
   Durante la instalación (o después, desde **Tools → Package Manager**), instalar el paquete
   **"TV Extensions"** (o "TV" bajo "Extension SDK") — sin esto no aparece el perfil `tv-samsung`.
2. **Crear el certificado de autor** (obligatorio incluso para instalar en tu propio TV, sin cuenta
   de vendedor Samsung ni costo): en Tizen Studio, **Tools → Certificate Manager → Tizen** → crear
   un perfil nuevo con un certificado de autor "self-signed". Anotá el nombre del perfil — hace
   falta para el paso de empaquetado.
3. **Reemplazar el placeholder de `config.xml`**: el certificado que acabás de crear tiene un
   prefijo de 10 caracteres propio (lo muestra Tizen Studio al crearlo). Reemplazá `XXXXXXXXXX` en
   `apps/tizen/config.xml` (los dos `id`/`package` de `<tizen:application>`) por ese valor real —
   **no es un dato que se pueda inventar**, cada certificado tiene el suyo.

## Modo desarrollador en el Samsung — una sola vez por TV

1. En el Samsung: pantalla de **Apps** → con el control remoto, escribir `1`, `2`, `3`, `4`, `5` en
   secuencia (sin ningún campo de texto enfocado) — aparece un panel oculto "Developer mode".
2. Activarlo (toggle ON) y cargar la **IP de tu PC** (la máquina donde corre Tizen Studio) en "Host
   PC IP".
3. Reiniciar la TV. Confirmá que tu PC y la TV están en la **misma red local**.

## Empaquetar e instalar

Con la TV en modo desarrollador y en la misma red:

```powershell
cd C:\Users\<vos>\Documents\cinefilo\apps\tizen

# Empaquetar (genera Miru.wgt) — reemplazá <perfil> por el nombre del
# certificado creado en el setup:
tizen package -t wgt -s <perfil> -- .

# Conectar a la TV (el puerto 26101 es fijo, la IP es la que ves en la
# pantalla de Developer mode del Samsung):
sdb connect <ip-de-la-tv>:26101

# Confirmar que la TV aparece como dispositivo conectado:
sdb devices

# Instalar:
tizen install -n Miru.wgt -t <device-id-de-sdb-devices>
```

(También se puede hacer todo desde la GUI de Tizen Studio: **File → Import → Tizen Project**
apuntando a `apps/tizen`, y después botón **Run** eligiendo la TV conectada como target — hace el
empaquetado + instalación en un solo paso.)

## Reinstalar después de cambios

Si lo que cambió fue `public/tv-lite.html` (lo más común): **no hace falta nada acá** — el redeploy
del backend ya lo actualiza, la próxima vez que se abra Miru en el TV carga la versión nueva sola.

Si cambió algo de `apps/tizen/` (el ícono, el nombre, `config.xml`): repetir `tizen package` +
`tizen install` (con `-n` reinstala encima, sin desinstalar antes).

## Qué probar

- Abrir Miru desde la pantalla de Apps del Samsung: fondo violeta un instante → redirige a
  `tv-lite.html` → carga el home (hero + tiras Top 5 por plataforma).
- Navegar todo con el control remoto: flechas, OK, Volver (los keycodes de Tizen ya están mapeados
  en `tv-lite.html` — no debería hacer falta tocar nada ahí).
- Abrir una ficha y tocar **"Ver ahora"**: confirmar qué pasa exactamente. Es el punto más incierto
  de esta v1 — en un WebView único sin chrome (sin pestañas, sin barra de direcciones), no está
  confirmado si `window.open()` abre algo aparte o si reemplaza la pantalla actual dejándote sin
  forma visible de volver a Miru (más que el Home/Exit del control). **Avisar cómo se comporta** —
  si navega mal, se agrega un botón "‹ Volver a Miru" en `tv-lite.html` en una vuelta siguiente.
- El tab "🎙 Hablar": sin micrófono en la mayoría de los Samsung, debería mostrar el toast de
  "Micrófono bloqueado" sin romper nada — comportamiento esperado, no es un bug.
- "Mi lista" / "Ya vistas" / "Plataformas": deberían funcionar igual que en cualquier navegador (son
  parte de `tv-lite.html`, no de esta cáscara).

## Fuera de alcance (por ahora)

- **Deep-link nativo** a Netflix/Prime/Disney+/etc. (abrir la app de Samsung directo en el título,
  no su web) — necesita los IDs de Tizen de cada app, que no están documentados públicamente y
  habría que confirmar probando en este mismo TV. Candidato para una v2.
- **Publicación en Samsung Seller Office** (la tienda oficial de apps de Samsung TV) — requiere
  cuenta de desarrollador Samsung, certificación de la app contra sus guías de UX de TV, y un
  proceso de revisión de semanas. Esta ronda es solo instalación en tu propio TV vía modo
  desarrollador, sin pasar por la tienda.
- Distribuir el `.wgt` desde `apps/landing` (como ya se hace con los `.apk`) — el mecanismo actual
  (código "Downloader" + URL corta con el control remoto) es específico de sideload en Android
  TV/Google TV y no tiene un equivalente directo en Tizen.
