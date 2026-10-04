# Paywall de Miru — Mercado Pago (plan de trabajo)

Contexto para cualquier sesión (sobre todo la **CLI local con el plugin de Mercado Pago**). Estado:
**en diseño**; no hay código de cobro todavía. Lo que está acá ya está decidido salvo lo marcado
como ⏳ PENDIENTE.

## Decisiones tomadas

- **Proveedor: Mercado Pago**, en ARS, Argentina primero. Stripe no (no opera con vendedores
  argentinos sin entidad afuera). Google Play Billing recién cuando la app esté en la Play Store
  (hoy es web en `www.mirumovies.com` + APK fuera de la tienda).
- **Modelo:** suscripción mensual automática ("Miru Premium") vía **API de Suscripciones
  (preapproval)** de Mercado Pago. Cancelable cuando quiera.
- **Escalones:**
  1. Sin cuenta: 3 recomendaciones de prueba (ya existe: `FREE_USES` en `apps/mobile/src/lib/auth.ts`).
  2. Cuenta gratis: ⏳ PENDIENTE N recomendaciones por mes.
  3. Premium: sin límite.
- **Precio:** ⏳ PENDIENTE (rango charlado: ARS 2.500–4.000/mes). **Prueba gratis:** ⏳ PENDIENTE (¿7 días?).
- **El límite lo controla el backend** (hoy se cuenta en el teléfono y se puede saltear).

## Arquitectura prevista (todavía no implementada)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Tabla `public.subscriptions` | Supabase (migración nueva) | `user_id` (PK, FK `auth.users`, on delete cascade), `status` (`authorized` / `paused` / `cancelled` / `pending`), `mp_preapproval_id`, `plan_id`, `next_payment_date`, `updated_at`. RLS: el usuario solo LEE la suya; escribe solo el backend (service role). |
| Uso mensual | Supabase | contador por usuario y mes para el tope de la cuenta gratis. |
| `POST /api/mp/subscribe` | `server-node.mjs` (servicio `miru-ai`) | con el JWT de Supabase del usuario, crea el preapproval (`external_reference` = `user_id`) y devuelve el `init_point` del checkout. |
| `POST /api/mp/webhook` | `server-node.mjs` | valida la firma `x-signature` con la clave secreta, consulta el estado en la API de MP y actualiza `subscriptions`. Idempotente. |
| Gate | `/api/recommend` | si el usuario no es Premium y pasó el tope del mes → 402 con mensaje; la app muestra "Pasate a Premium". |
| UI | `apps/mobile` (`ProfileSheet`, `ChatScreen`) | botón "Pasate a Premium", tu plan, cuántas te quedan, cancelar. Vuelta del checkout: `https://www.mirumovies.com/?premium=ok` / `?premium=error`. |

URLs fijas (usarlas tal cual al configurar Mercado Pago):

- Webhook: `https://miru-ai.up.railway.app/api/mp/webhook`
- Vuelta (back_url): `https://www.mirumovies.com/?premium=ok`

Variables de entorno (en Railway, servicio `miru-ai`; **nunca en el repo ni en un chat**):

- `MP_ACCESS_TOKEN` — Access Token (primero el de PRUEBA, después el de producción)
- `MP_WEBHOOK_SECRET` — clave secreta de las notificaciones
- `MP_PLAN_ID` — id del plan de suscripción (no es secreto)

## Tarea para la CLI local con el plugin de Mercado Pago

Objetivo: dejar la cuenta de Mercado Pago lista para que el código de arriba se pueda conectar.
Todo en **modo prueba** primero.

1. Verificar la cuenta: datos fiscales / identidad completos para cobrar suscripciones. Si falta
   algo, decirle a Agustín qué y dónde (no inventar datos).
2. Aplicación en "Tus integraciones": producto Suscripciones. Confirmar dónde están las credenciales
   de prueba y de producción. **No mostrar ni copiar las claves en el chat ni en archivos del repo**:
   Agustín las carga él mismo en Railway.
3. Recomendar suscripción **con plan** (`preapproval_plan`) o **sin plan**, con el porqué. Si es con
   plan, crearlo en PRUEBA: "Miru Premium", mensual, ARS ⏳ precio, ⏳ prueba gratis,
   `back_url` = la de arriba.
4. Webhooks: apuntar a la URL de arriba, activar los eventos de suscripciones
   (`subscription_preapproval`), pagos autorizados de suscripción
   (`subscription_authorized_payment`) y `payment`. Indicar dónde está la clave secreta.
5. Crear usuarios de prueba (vendedor y comprador) y anotar qué tarjetas de prueba usar para
   aprobado / rechazado.
6. Explicar qué pasa cuando falla un cobro (reintentos, pausa, cancelación) y qué estados llegan, y
   cómo cancela el usuario (desde MP y/o por API).
7. Comisiones y plazos de acreditación para suscripciones en Argentina.

**Qué devolver** (pegarlo en `docs/PAYWALL.md`, sección "Resultado de la configuración", o pasárselo a
la sesión de código): el **id del plan** (si hay), la decisión con/sin plan, los eventos activados,
los nombres de los usuarios de prueba (sin contraseñas) y cualquier restricción que haya aparecido.
NO devolver Access Tokens ni la clave secreta.

## Resultado de la configuración

**Estado: configuración de cuenta/paneles en progreso — ver pendientes al final.**
**Precio y prueba gratis confirmados por Agustín:** ARS 3.499/mes, 7 días de prueba gratis.

- **Cuenta / identidad**: no hay endpoint en la documentación de developers para verificar esto por
  API. Agustín debe confirmar en su cuenta de Mercado Pago ("Tu negocio" / datos de la cuenta) que
  estén completos identidad (CUIT/DNI) y datos fiscales. ⏳ pendiente de Agustín.
- **Aplicación creada**: "Miru", **App ID `2679822576461342`**, país MLA (Argentina), producto
  Suscripciones. Credenciales de prueba y producción: Developer Dashboard → esta app →
  Credenciales (no se mostraron en este chat ni se guardaron en el repo).
- **Decisión con/sin plan: CON plan asociado (`preapproval_plan`)**. Precio y frecuencia son iguales
  para todos los suscriptores (sin descuentos por usuario) — es exactamente el caso de "con plan"
  según la doc oficial. Flujo: 1) se crea el plan una sola vez; 2) cada suscripción se crea con
  `preapproval_plan_id` + `card_token_id` + `status: authorized` (la tarjeta se tokeniza en una
  página de Mercado Pago o un Brick, nunca como texto plano en el backend).
- **Plan de PRUEBA — pendiente, crear desde el panel** (para no manejar el Access Token en este
  chat): Developer Dashboard → "Planes de suscripción" → "Crear nuevo plan", con modo de prueba
  activo:
  - Nombre: `Miru Premium`
  - Precio: `ARS 3.499`
  - Frecuencia: `Mensual`
  - Prueba gratis: `7 días`
  - Duración: `Ilimitada`
  - Día de facturación: el que sugiera el panel (cobro proporcional activado)
  - URL de redirección (`back_url`): `https://www.mirumovies.com/?premium=ok`
  - El `external_reference` (id de usuario) va en cada `preapproval`, no en el plan — no hace falta
    completarlo acá.
  ⏳ **Agustín: crear el plan y pasar el `id` resultante** (no es secreto) para completar
  `MP_PLAN_ID`.
- **Webhooks**: configurados vía MCP. URL (prueba y producción): `https://miru-ai.up.railway.app/api/mp/webhook`.
  Eventos activados: `subscription_preapproval`, `subscription_authorized_payment`, `payment`.
  Clave secreta: visible solo en Developer Dashboard → esta app → Webhooks (no se mostró acá) —
  cargarla en Railway como `MP_WEBHOOK_SECRET`.
- **Validación de firma `x-signature`** (para `server-node.mjs`): header con formato
  `ts=<timestamp>,v1=<hash>`. Armar el manifest `id:{data.id en minúsculas};request-id:{x-request-id};ts:{ts};`,
  calcular `HMAC-SHA256` en hex con la clave secreta, y comparar con `v1` usando una comparación
  **timing-safe** (`crypto.timingSafeEqual`, nunca `===`/`==` directo). El SDK oficial de Node trae
  `WebhookSignatureValidator` que hace esto automáticamente.
- **Usuarios de prueba creados**:
  - Vendedor: `TESTUSER3339812097470770002` (id `3732709349`)
  - Comprador: `TESTUSER1738262272048485433` (id `3732709353`), con ARS 20.000 cargados
- **Tarjetas de prueba (Argentina)** — vencimiento `11/30`, CVV `123` (Amex `1234`):

  | Tipo | Marca | Número |
  |---|---|---|
  | Crédito | Mastercard | 5031 7557 3453 0604 |
  | Crédito | Visa | 4509 9535 6623 3704 |
  | Crédito | Amex | 3711 803032 57522 |
  | Débito | Mastercard | 5287 3383 1025 3304 |
  | Débito | Visa | 4002 7686 9439 5619 |

  Para forzar un resultado, poné como **nombre del titular** uno de estos códigos: `APRO` (aprobado),
  `FUND` (fondos insuficientes), `OTHE` (error general), `CONT` (pendiente), `CALL` (requiere
  autorización), `SECU` (CVV inválido), `EXPI` (vencida).
- **Qué pasa si falla un cobro mensual**: la cuota pasa a `recycling` y Mercado Pago reintenta
  automáticamente hasta 4 veces en una ventana de 10 días. Tras **3 cuotas rechazadas consecutivas**,
  la suscripción se **cancela automáticamente** y se notifica por mail al vendedor. Estados del
  `preapproval`: `pending`, `authorized`, `paused`, y `canceled` (una sola "l", distinto del inglés
  "cancelled").
- **Cómo cancela el usuario**: por API, `PUT /preapproval/{id}` con `status: "paused"` o
  `"canceled"` — así lo va a hacer el botón de Miru en la app. Del lado del vendedor también se
  puede pausar/cancelar manualmente desde el panel ("Planes de suscripción" → "Suscriptores" → "Ver
  detalles" → "Cancelar", irreversible). No se encontró en la documentación un flujo de
  autocancelación del lado del PAGADOR dentro de su propia cuenta de Mercado Pago — conviene que
  Miru lo resuelva con el botón propio que llama al `PUT`.
- **Reintentos de entrega del webhook** (si el servidor no responde 200/201 en 22s): Mercado Pago
  reintenta a los 0 min, 15 min, 30 min, 6 h, 48 h, y luego cada 96 h (hasta 8 intentos en total).
- **Comisiones y plazos de acreditación**: la documentación de developers no publica el detalle
  (remite al Centro de Ayuda / panel comercial de Mercado Pago, fuera de `/developers`). Lo único
  confirmado ahí: la liberación de fondos se calcula por cuota (campo `MONEY_RELEASE_DATE` en los
  reportes de liquidaciones). Para el % exacto y si cambia según el plazo elegido, consultar el
  Centro de Ayuda o la sección de tarifas del panel comercial.

## Pendientes (⏳ para Agustín)

1. Confirmar en la cuenta de Mercado Pago que los datos de identidad/fiscales estén completos para
   cobrar suscripciones.
2. Crear el plan de prueba desde el panel (ver arriba) y pasar el `plan_id` resultante.
3. Cargar en Railway (servicio `miru-ai`): `MP_ACCESS_TOKEN` (de prueba), `MP_WEBHOOK_SECRET`, y
   `MP_PLAN_ID` una vez creado el plan.
4. Antes de producción: repetir la creación del plan en modo producción, cargar las credenciales de
   producción en Railway, y correr `/mp-review` + el checklist de homologación.
