# Control de la TV desde afuera — prueba de concepto

Script suelto para contestar, **antes** de invertir en un plugin nativo para la app móvil,
si vale la pena meter un control remoto de TV dentro de Miru.

Usa el protocolo **Android TV Remote v2**, el mismo que usa la app "Google TV" del celular
para manejar tu televisor. Lo importante no es mandar flechas: es que permite
**abrir un título exacto en Netflix / Prime / Disney+ en la TV**, aunque esa TV
**no tenga Miru instalado**.

No toca el producto. Nada de esto se deploya (Railway solo instala el `package.json` de la raíz).

## Qué queremos responder

1. ¿Podemos parear con la TV de casa y mandarle órdenes?
2. ¿Podemos abrir un título exacto desde afuera?
3. ¿El deep link **sobrevive al muro de perfiles**, o queda esperando ahí? ← la pregunta cara
4. ¿El deeplink que da JustWatch para `ANDROID_TV` es mejor que el de `WEB` (el que usa la app hoy)?

## Requisitos

- Node 18+ en la PC.
- La PC y la TV en **la misma red**.
- La IP de la TV: en el televisor, Ajustes → Red.

## Cómo se corre

```bash
cd scripts/tv-remote
npm install

# 1. Parear (una sola vez). La TV muestra un código de 6 caracteres.
node poc.mjs pair 192.168.0.42

# 2. Ver los deeplinks de un título, sin tocar la TV
node poc.mjs links "Mad Max Fury Road"

# 3. La prueba que importa: abrir ese título en la TV
node poc.mjs open 192.168.0.42 "Mad Max Fury Road"

# Extras
node poc.mjs link  192.168.0.42 "nflx://www.netflix.com/title/12345"
node poc.mjs key   192.168.0.42 KEYCODE_DPAD_CENTER
node poc.mjs watch 192.168.0.42     # qué app está en pantalla, en vivo
```

País por defecto `AR`; se cambia con `MIRU_COUNTRY=MX node poc.mjs ...`.

## Qué anotar en el paso 3

Por cada plataforma (Netflix, Prime Video, Disney+, Max), y para cada caso
(sesión con **un** perfil / con **varios** perfiles / sin sesión):

- **a)** abrió la app **y el título exacto**
- **b)** abrió la app pero quedó en el **selector de perfiles** (¿y después del perfil llega al título, o se pierde?)
- **c)** abrió la app en su home, sin el título
- **d)** no pasó nada

Eso es exactamente lo que falta para decidir. Si da (a) o (b)-con-recuperación en las
plataformas principales, tiene sentido el paso siguiente: llevar esto adentro de la app móvil.

## Si funciona, ¿qué falta para meterlo en la app?

La librería es JavaScript, pero necesita **sockets TCP con TLS y certificado de cliente**,
y eso no existe dentro del WebView de Capacitor. Hay que escribir un **plugin nativo Android**
(Kotlin) que haga el pairing y la conexión, y exponer `sendAppLink` / `sendKey` a la app.
Es trabajo real y solo corre en el **APK Android** (no en la versión web ni en iOS).

## Ojo

- `cert.json` es la credencial del pairing con tu TV: queda ignorada por git, no la subas.
- JustWatch es una API no oficial: sirve para la prueba, no es un compromiso de producto.
