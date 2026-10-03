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

_(vacío — completar después de la configuración)_
