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

Ya está hecho en la máquina de Agustín (ver "Estado actual" abajo). Estos pasos son para
reproducirlo en otra máquina.

**No hace falta Tizen Studio (el IDE).** Alcanza con el CLI, y se puede instalar **sin el
instalador `.exe`** — que pide UAC y no se puede automatizar. Los paquetes del SDK son `.zip`
planos que se extraen a mano:

1. **Bajar los paquetes del CLI** desde el repo oficial
   (`https://download.tizen.org/sdk/tizenstudio/official/binary/`). El cierre de dependencias
   mínimo, partiendo de `WebCLI` + `Certificate-Manager` + `sdb`, son ~20 paquetes (~200 MB);
   la lista se resuelve leyendo `pkg_list_windows-64` del directorio padre. Extraer el `data/`
   de cada zip sobre una misma raíz (ej. `%USERPROFILE%\tizen-studio`).
2. **Crear `sdk.info` a mano** en la raíz — lo genera el instalador, no viene en ningún paquete,
   y sin él el CLI aborta con *"Tizen Studio is not installed properly"*:
   ```
   TIZEN_SDK_INSTALLED_PATH=C:\Users\<vos>\tizen-studio\
   TIZEN_SDK_DATA_PATH=C:\Users\<vos>\tizen-studio-data\
   TIZEN_SDK_VERSION=6.1
   TIZEN_SDK_RELEASE_VERSION=6.1
   ```
3. **Certificado de autor** (gratis, sin cuenta de vendedor Samsung), todo por CLI:
   ```powershell
   tizen certificate -a Miru -p <pass> -n "<tu nombre>" -c AR -o Miru -f miru-author -- <dir-certs>
   tizen security-profiles add -n MiruProfile -a <dir-certs>\miru-author.p12 -p <pass>
   ```
   ⚠️ **Bug conocido**: `security-profiles add` escribe en `profiles.xml` (en
   `tizen-studio-data\profile\`) rutas a archivos `.pwd` **que nunca crea**, y el empaquetado
   después falla. El fix es editar ese `profiles.xml` y poner las contraseñas en texto plano:
   la tuya en el `distributor="0"`, y `tizenpkcs12passfordsigner` (la pública de Tizen) en el
   `distributor="1"`.

**El `<tizen:application id>` / `package` de `config.xml`** ya está fijado en `MiruTV0001`. Para
sideload en modo desarrollador el package ID es un valor **libre** de 10 caracteres alfanuméricos
(Tizen Studio lo generaría solo si crearas el proyecto desde la GUI) — no sale del certificado.
**No lo cambies**: es la identidad de actualización de la app en el TV.

## Modo desarrollador en el Samsung — una sola vez por TV

1. En el Samsung: pantalla de **Apps** → con el control remoto, escribir `1`, `2`, `3`, `4`, `5` en
   secuencia (sin ningún campo de texto enfocado) — aparece un panel oculto "Developer mode".
2. Activarlo (toggle ON) y cargar la **IP de tu PC** (la máquina donde corre Tizen Studio) en "Host
   PC IP".
3. Reiniciar la TV. Confirmá que tu PC y la TV están en la **misma red local**.

## Estado actual

`Miru.wgt` **ya está empaquetado y firmado** (~188 KB) en esta carpeta, listo para instalar en un
Samsung. Falta solamente el paso de instalación, que necesita un TV Samsung en modo desarrollador
en la misma red.

## Empaquetar

```powershell
cd apps\tizen
.\build-wgt.ps1
```

El script arma un staging con **solo** `config.xml` + `index.html` + `icon.png`, empaqueta, firma,
y **verifica que el `.wgt` tenga las dos firmas** antes de darlo por bueno. El staging existe
porque `tizen package -- .` mete en el paquete *todo* lo que encuentre en el directorio (el
README, el propio script, `.wgt` viejos).

Dos gotchas que el script ya resuelve, por si alguna vez empaquetás a mano:

- **`IllegalAccessError` de xerces**: el CLI es de la era Java 8 y un JDK moderno le corta el
  acceso a una clase interna. Se arregla con
  `JAVA_TOOL_OPTIONS=--add-exports=java.xml/com.sun.org.apache.xerces.internal.impl.dv.util=ALL-UNNAMED`.
- El CLI necesita un `JAVA_HOME`; sirve el JBR que ya trae Android Studio.

## Instalar en la TV

Con la TV en modo desarrollador y en la misma red:

```powershell
# El puerto 26101 es fijo; la IP es la que muestra la pantalla de Developer mode.
sdb connect <ip-de-la-tv>:26101
sdb devices                                   # confirmar que aparece
tizen install -n Miru.wgt -t <device-id>      # -n reinstala encima
```

(`sdb.exe` y `tizen.bat` están en `%USERPROFILE%\tizen-studio\tools\` y
`...\tools\ide\bin\` respectivamente.)

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
