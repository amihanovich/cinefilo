# Descargas

Acá van los APK compilados. El servidor siempre sirve el archivo que esté guardado
con estos nombres fijos, así el link nunca cambia entre versiones:

| Ruta pública           | Archivo esperado en esta carpeta |
| ---------------------- | --------------------------------- |
| `/download/android`    | `cinefilo-mobile.apk`             |
| `/download/androidtv`  | `cinefilo-tv.apk`                 |

## Cómo publicar una versión nueva

1. Reemplazá el archivo correspondiente en esta carpeta (mismo nombre de siempre).
2. `git add landing/downloads/cinefilo-mobile.apk` (o `cinefilo-tv.apk`) y commiteá.
3. Pusheá a la rama conectada a Railway — el deploy se dispara solo y el link
   público empieza a servir el nuevo archivo automáticamente.
4. La primera vez que subas un APK, sacá la clase `is-disabled` del botón
   correspondiente en `landing/index.html` para que deje de mostrar "Próximamente".

## Nota sobre el tamaño del repo

Como los APK se versionan en git, cada actualización agranda el historial del
repositorio (git no "sobrescribe" el binario anterior, lo agrega). Para uso
personal con actualizaciones ocasionales esto no es un problema. Si en algún
momento empezás a publicar builds muy seguido o los APK crecen mucho, conviene
migrar esta carpeta a Git LFS o a un bucket externo (S3, Railway Volume, etc.)
y dejar que `server.js` haga un redirect en vez de servir el archivo directo.
