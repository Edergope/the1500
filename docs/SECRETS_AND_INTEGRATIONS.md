# Credenciales de staging, paso a paso

Comprobado contra la documentación de Resend y Stripe el 2026-11-04. Los paneles cambian: si un botón tiene otro nombre, se sigue la misma intención. La sección de Claude Console no se pudo comprobar en línea.

**Estado actual, modo seguro:** ningún secreto configurado, `PAYMENTS_ENABLED="false"`, sin producción. El código rechaza las claves `sk_live_` y `rk_live_` aunque alguien las configure. Nada de esta guía habilita cobros reales.

**Orden:** 1 Resend, 2 Stripe sandbox, 3 LLM. Se empieza por el correo porque sin él nadie puede iniciar sesión, y las otras dos verificaciones necesitan una sesión. No se pasa a la siguiente sin haber verificado la anterior.

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

## 1. Correo: Resend

### 1.1 Obtener la clave
1. Crea una cuenta en https://resend.com con un correo al que tengas acceso. Ese correo importa: ver 1.3.
2. Ve a https://resend.com/api-keys y pulsa **Create API Key**.
3. Nombre: `the1500-staging`. Permiso: **Sending access**, no Full access.
4. Copia la clave. Resend la muestra **una sola vez**.

### 1.2 Guardarla en Cloudflare
```bash
npx wrangler secret put RESEND_API_KEY --name the1500-staging
```

### 1.3 Remitente
`MAIL_FROM` no es secreto y vive en `wrangler.jsonc`. Claude lo cambia y despliega; solo necesita saber cuál usar.

- **Sin dominio, para verificar ya:** `THE1500 <onboarding@resend.dev>`. Resend solo permite enviar así **al correo de tu propia cuenta de Resend**. Basta para esta verificación y para crear el administrador. A cualquier otra dirección el envío falla y el acceso responde 503.
- **Con dominio, necesario para otros usuarios:** en https://resend.com/domains pulsa **Add Domain** y usa un subdominio de envío, como `mail.tudominio.com`. Copia los registros DKIM y SPF en tu DNS, exactamente; si alguno es CNAME en Cloudflare, sin proxy. Suele verificarse en 15 minutos y puede tardar hasta 72 horas. Después añade DMARC y, si quieres, restringe la clave a ese dominio.

### 1.4 Verificar
1. Abre https://the1500-staging.admonpalmerafood.workers.dev/login y escribe el correo de tu cuenta de Resend.
2. Debe llegar el enlace (revisa spam). Vale 15 minutos y una sola vez.
3. Ábrelo y confirma. Debes llegar a `/mi-cuenta` con tu correo visible.

**Hecho cuando:** entras con un enlace recibido de verdad. Si responde 503, la clave o el remitente no están bien; el registro está en https://resend.com/emails.

### 1.5 Primer administrador
Después de tu primer acceso, y con tu confirmación de que ese correo es el del administrador, Claude ejecuta sobre D1 remoto el alta de `docs/CORE004_IMPLEMENTATION.md` §3. Entonces https://the1500-staging.admonpalmerafood.workers.dev/api/v1/admin/integrations debe mostrar `mail.configured: true`. Esa página nunca muestra valores.

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
| Resend | https://resend.com/api-keys | `secret put` con la nueva |
| Stripe | https://dashboard.stripe.com/apikeys → ⋯ → **Rotate key**. Webhook: ⋯ → **Roll secret** | `secret put` con la nueva |
| Claude | Claude Console → API keys | `secret put` con la nueva |

Para retirar un secreto sin reemplazarlo:

```bash
npx wrangler secret delete NOMBRE --name the1500-staging
```

## Fuera de esta guía

Claves `live`, producción, cobros reales y entidad vendedora. Requieren nueva autorización. `RESEND_API_BASE`, `STRIPE_API_BASE` y `AI_BASE_URL` son solo para los simuladores locales: no se definen en staging.
