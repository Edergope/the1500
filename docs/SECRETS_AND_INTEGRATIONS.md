# Credenciales de staging, paso a paso

Comprobado contra la documentación de Cloudflare, Resend y Stripe el 2026-11-04. Los paneles cambian: si un botón tiene otro nombre, se sigue la misma intención. La sección de Claude Console no se pudo comprobar en línea.

**Estado actual, modo seguro:** ningún secreto configurado, sin remitente de correo, `PAYMENTS_ENABLED="false"`, sin producción. El código rechaza las claves `sk_live_` y `rk_live_` aunque alguien las configure. Nada de esta guía habilita cobros reales.

**Orden:** 1 correo, 2 Stripe sandbox, 3 LLM. Se empieza por el correo porque sin él nadie puede iniciar sesión, y las otras dos verificaciones necesitan una sesión. No se pasa a la siguiente sin haber verificado la anterior.

## Reglas para no exponer un secreto

1. El valor solo se pega en el aviso `Enter a secret value` de Wrangler, en tu terminal. Ahí queda enmascarado.
2. Nunca en un chat (tampoco este), correo, documento, captura de pantalla, `wrangler.jsonc`, `.env` confirmado en git, ni como argumento de un comando.
3. Las copias se quedan en tu gestor de contraseñas, si quieres conservarlas. Cloudflare no permite volver a leerlas.
4. Si un valor se expone: revócalo primero en el proveedor, crea otro y repite el `secret put`. Borrarlo del chat o de git no basta.
5. Cada `secret put` publica una versión nueva del Worker de staging. Es normal.

Comprobar qué hay configurado (muestra nombres, nunca valores):

```bash
npx wrangler secret list --name the1500-staging
```

Todos los comandos se ejecutan desde la carpeta del proyecto, con la sesión de Wrangler en la cuenta de staging:

```bash
cd /Users/edergope/THE1500/THE1500_ENTREGA_INTEGRAL_CLAUDE_2026-11-03/01_CODIGO_ACTUAL_CORE004_v0_3
```

## 1. Correo: Cloudflare Email Sending

Proveedor aprobado por el propietario el 2026-11-04. Usa el binding `EMAIL` del Worker, así que **no hay clave que guardar**. El código ya está desplegado, pero sin remitente no envía nada.

Sending sigue en beta y parte de un cupo diario "conservador" sin cifra publicada. Antes del lanzamiento hay que comprobar la entrega y pedir aumento en el formulario enlazado desde https://developers.cloudflare.com/email-service/platform/limits/.

### 1.1 Requisitos, los dos a cargo del propietario
1. **Workers Paid** en la cuenta del Worker: desde 5 USD/mes, con 3.000 correos incluidos y 0,35 USD por 1.000 adicionales. Se contrata por cuenta, así que también cubre lo demás que haya en ella. Panel de Cloudflare → Workers & Pages → Plans.
2. **Un dominio en Cloudflare DNS** en esa misma cuenta. Se recomienda enviar desde un subdominio, como `mail.tudominio.com`.

### 1.2 Activar el dominio
En el panel: Email Service → Email Sending → onboarding del subdominio. O bien, con Claude y tu autorización:

```bash
npx wrangler email sending enable mail.tudominio.com
```

Cloudflare añade los registros SPF, DKIM, DMARC y de rebotes, normalmente en 5 a 15 minutos. Si Wrangler responde `Unauthorized`, hay que renovar su permiso con `npx wrangler login`.

### 1.3 Remitente
`MAIL_FROM` no es secreto y vive en `wrangler.jsonc`, por ejemplo `THE1500 <signin@mail.tudominio.com>`. Claude lo cambia y despliega.

### 1.4 Verificar
1. Abre https://the1500-staging.admonpalmerafood.workers.dev/login con una dirección real de **Gmail** y repite con una de **Outlook**.
2. Debe llegar el enlace a la bandeja de entrada, no a spam. Vale 15 minutos y una sola vez.
3. Ábrelo y confirma. Debes llegar a `/mi-cuenta`.
4. Vuelve a abrir el mismo enlace y confirma: debe rechazarlo.
5. Claude revisa en los encabezados que SPF, DKIM y DMARC pasen.

**Hecho cuando:** los cinco puntos pasan en ambos buzones. Si no pasan, se cambia al respaldo: Resend.

### 1.5 Primer administrador
Después de tu primer acceso, y con tu confirmación de que ese correo es el del administrador, Claude ejecuta sobre D1 remoto el alta de `docs/CORE004_IMPLEMENTATION.md` §3. Entonces https://the1500-staging.admonpalmerafood.workers.dev/api/v1/admin/integrations debe mostrar `mail.provider: "cloudflare"` y `mail.configured: true`.

### 1.6 Respaldo: Resend (sin activar)
El adaptador se conserva y no requiere cambios de código. Solo si se decide usarlo:

1. Crea una cuenta en https://resend.com y una clave en https://resend.com/api-keys con permiso **Sending access**. Se muestra una sola vez.
2. Guárdala en Cloudflare:
```bash
npx wrangler secret put RESEND_API_KEY --name the1500-staging
```
3. Verifica el dominio en https://resend.com/domains. Sin dominio, `onboarding@resend.dev` solo envía al correo de tu propia cuenta de Resend.
4. Claude cambia `MAIL_PROVIDER` a `"resend"` y `MAIL_FROM`, y despliega.

## 2. Pagos de prueba: Stripe sandbox

**Antes de empezar:** comprueba que el selector de cuenta del panel dice **sandbox**. Una clave de prueba empieza por `rk_test_` o `sk_test_`. Si ves `live`, detente. Ningún cobro de sandbox pasa por las redes de tarjetas.

### 2.1 Clave restringida
1. Crea una cuenta en https://stripe.com y un sandbox separado para THE1500. La entidad vendedora sigue sin definir: no completes la activación para cobros reales.
2. En https://dashboard.stripe.com/apikeys pulsa **Create restricted key**, nombre `the1500-staging`.
3. Deja todo en **None** excepto: Checkout Sessions **Write**, Payment Intents **Read**, Charges **Read**, Refunds **Write**. Si los nombres difieren o falta algo, el registro de la clave muestra qué se rechazó con `403`.
4. Copia el valor.

```bash
npx wrangler secret put STRIPE_SECRET_KEY --name the1500-staging
```

### 2.2 Webhook
1. En https://dashboard.stripe.com/webhooks pulsa **Create an event destination**.
2. Elige **Your account**.
3. Formato de carga: **Snapshot**. Stripe sugiere Thin, pero **este backend necesita Snapshot**: lee el objeto completo del evento.
4. Eventos: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
5. Destino **Webhook endpoint**, URL `https://the1500-staging.admonpalmerafood.workers.dev/api/v1/webhooks/stripe`.
6. En la página del endpoint pulsa **Reveal secret** y copia el `whsec_…`.

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --name the1500-staging
```

### 2.3 Activar el modo de prueba
Claude cambia `PAYMENTS_ENABLED` a `"true"` y despliega, solo cuando confirmes y solo en staging. `admin/integrations` debe mostrar `stripe.gate: "open_test_mode"` y `keyIsTestMode: true`.

### 2.4 Verificar
1. Una empresa de prueba reserva y va a Checkout con la tarjeta `4242 4242 4242 4242`, fecha futura y cualquier CVC.
2. En el webhook de Stripe, **Event deliveries** muestra `200`.
3. `GET /me/company` muestra el número adjudicado y `/admin/payments` el pago como `paid`.
4. Reembolso de prueba desde `/admin/payments/refund`.
5. Pago después de la reserva: va a `late_review` con `paidAtSource: provider_charge`.

**Hecho cuando:** los cinco puntos pasan. Claude comprueba también que la versión de API fijada en `src/core/stripe.ts` coincide con la que acepta la cuenta.

Una vez puesto el secreto real, `tests/remote/staging.cjs` no debe ejecutarse sin cambiarlo.

## 3. LLM: Claude API

La API se factura por uso, aparte de cualquier suscripción. Conviene fijar un límite de gasto.

1. En Claude Console (https://platform.claude.com/settings/keys) crea una clave llamada `the1500-staging`.
2. Configura facturación y un límite de gasto bajo.

```bash
npx wrangler secret put AI_API_KEY --name the1500-staging
```

### Verificar
1. `admin/integrations` muestra `ai.configured: true`.
2. Una empresa con cupo envía su formulario: `generation.mode` debe ser `llm`, con `provider` y `model`.
3. La vista previa marca qué texto es `ai_generated`.
4. `POST /public/ask` sobre un perfil publicado responde `llm_grounded`, con citas cuyo digest se verifica.
5. Sin evidencia, el asistente se abstiene.

**Hecho cuando:** los cinco puntos pasan y Claude ha revisado varios perfiles para calibrar `src/core/claims.ts`, que puede rechazar textos válidos. Modelo por defecto: `claude-opus-5-5`, cambiable con `AI_MODEL`.

## Revocar

| Proveedor | Dónde | Después |
|---|---|---|
| Resend, si se activa | https://resend.com/api-keys | `secret put` con la nueva |
| Stripe | https://dashboard.stripe.com/apikeys → ⋯ → **Rotate key**. Webhook: ⋯ → **Roll secret** | `secret put` con la nueva |
| Claude | Claude Console → API keys | `secret put` con la nueva |

Para retirar un secreto sin reemplazarlo:

```bash
npx wrangler secret delete NOMBRE --name the1500-staging
```

## Fuera de esta guía

Claves `live`, producción, cobros reales y entidad vendedora. Requieren nueva autorización. `RESEND_API_BASE`, `STRIPE_API_BASE` y `AI_BASE_URL` son solo para los simuladores locales: no se definen en staging.
