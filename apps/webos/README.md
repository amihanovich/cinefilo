# Miru — app de LG webOS

Cáscara para LG webOS, hermana de `apps/tizen` (Samsung) y `apps/tv` (Android): **no bundlea nada
propio**, solo carga remoto `public/tv-lite.html` (servida por el backend en Railway). Por eso
`index.html` no tiene lógica salvo un redirect — toda la app de verdad vive en `tv-lite.html` y se
actualiza sola con cada redeploy del backend, **sin reempaquetar el `.ipk`**.

Cubre LG (segunda marca mundial de TVs) y las marcas chicas que licencian webOS Hub (Hyundai, RCA,
Konka). Con esto + `apps/tizen` (Samsung) + `apps/tv` (Android TV/Google TV) queda cubierta la
enorme mayoría del parque instalado.

**v1: sin deep-link nativo a Netflix/Prime/etc.** — igual que en Tizen, "Ver ahora" cae al fallback
web genérico de `tv-lite.html`. Ver `ARCHITECTURE.md` para el resto del contexto.

## Más fácil que Tizen

Dos diferencias que hacen esto mucho menos trabajoso que la app de Samsung:

- **No hay firma.** El `.ipk` para modo desarrollador va tal cual: no hay certificados, ni perfiles,
  ni `profiles.xml`. (Comparar con `apps/tizen/README.md`, que arrastra todo eso.)
- **El CLI es un paquete npm**, no un SDK de 200 MB: `npm i -g @webosose/ares-cli`.

## Empaquetar

```powershell
cd apps\webos
.\build-ipk.ps1
```

Genera `com.miru.tv_<version>_all.ipk` (~19 KB) y **verifica el contenido**: que estén los 4
archivos de la app y que NO se hayan colado este README ni el script. El empaquetador se lleva todo
lo que encuentra en el directorio, así que el script pasa `-e/--app-exclude` por cada cosa que no es
la app.

## Modo desarrollador en el LG — una sola vez por TV

⚠️ **Más molesto que en Samsung, y con una trampa**: necesita una **cuenta de desarrollador LG**
(gratis) y la sesión de modo desarrollador **expira a las ~50 horas**. Se renueva desde la misma app
Developer Mode ("Extend session" / "Key Server" ON), pero **si vence, el TV desactiva las apps
sideloadeadas**. Para un beta tester que no va a renovarla, tenerlo en cuenta.

1. Crear una cuenta gratis en [webostv.developer.lge.com](https://webostv.developer.lge.com/).
2. En el TV: **LG Content Store** → buscar e instalar la app **"Developer Mode"**.
3. Abrirla, loguearse con esa cuenta, y activar **Dev Mode Status: ON** (el TV se reinicia).
4. Al volver, la app muestra la **IP** y el **passphrase** — hacen falta para el paso siguiente.

## Instalar en la TV

Con el TV en modo desarrollador y en la misma red:

```powershell
# Registra el TV una vez (pide IP y passphrase de la app Developer Mode):
ares-setup-device

# Confirmar que quedó registrado:
ares-setup-device --list

# Instalar (-d = nombre que le pusiste al device):
ares-install com.miru.tv_0.1.0_all.ipk -d <device>

# Abrir sin tocar el control:
ares-launch com.miru.tv -d <device>
```

## Reinstalar después de cambios

Si lo que cambió fue `public/tv-lite.html` (lo más común): **no hace falta nada acá** — el redeploy
del backend ya lo actualiza. Si cambió algo de esta carpeta (ícono, nombre, `appinfo.json`):
`.\build-ipk.ps1` + `ares-install` de nuevo.

**No cambiar el `id` de `appinfo.json`** (`com.miru.tv`): es la identidad de actualización de la app
en el TV, igual que el package ID en Tizen.

## Qué probar

- Abrir Miru desde la grilla de apps: fondo violeta un instante → redirige a `tv-lite.html` → home
  (hero + tiras Top 5 por plataforma).
- **El botón Volver del control** (el keycode 461 de webOS ya está mapeado en `tv-lite.html`, junto
  al 10009 de Tizen). `appinfo.json` pone `disableBackHistoryAPI: true` justamente para que el Back
  llegue como keydown y lo maneje la app, en vez de que webOS haga `history.back()` por su cuenta.
- Navegación general con el Magic Remote: las flechas y OK son keycodes estándar. Ojo que el Magic
  Remote también tiene **puntero**: `tv-lite.html?touch=1` (la web touch) podría ser mejor
  experiencia ahí — probar y ver.
- **"Ver ahora"**: mismo punto incierto que en Tizen — confirmar si `window.open()` abre algo aparte
  o reemplaza la pantalla sin forma visible de volver. **Avisar cómo se comporta.**
- El tab "🎙 Hablar": sin micrófono, debería mostrar el toast de "Micrófono bloqueado" sin romper
  nada — comportamiento esperado, no es un bug.

## Fuera de alcance (por ahora)

- **Deep-link nativo** a las apps de streaming (webOS usa un esquema propio de launch por app id) —
  misma v2 pendiente que Tizen.
- **Publicación en el LG Content Store** — requiere cuenta de desarrollador verificada y proceso de
  revisión. Esta ronda es solo sideload en modo desarrollador.
