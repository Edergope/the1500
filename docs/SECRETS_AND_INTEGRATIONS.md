# Secretos e integraciones de staging

Nunca se pegan en un chat ni se guardan en el repositorio. Cada secreto se escribe en el aviso del comando, que lo cifra en Cloudflare. Cada `secret put` publica una versión nueva del Worker de staging; producción no existe.

Comprobación después de configurar, con sesión de administrador: `GET /api/v1/admin/integrations`. Solo informa si cada integración está presente y en qué modo, nunca el valor.

## Secretos

| Secreto | De dónde sale | Sin él |
|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys, con permiso solo de envío | El acceso por enlace mágico responde 503 y las notificaciones quedan en cola |
| `STRIPE_SECRET_KEY` | Stripe, **modo Test** → Developers → API keys (`sk_test_…` o `rk_test_…`) | Pagos cerrados |
| `STRIPE_WEBHOOK_SECRET` | Stripe, modo Test → Webhooks → el endpoint de abajo → Signing secret (`whsec_…`) | Todo webhook se rechaza |
| `AI_API_KEY` | Claude Console → API keys | Perfiles con las palabras del titular y asistente `retrieval_only`, ambos etiquetados |

```bash
npx wrangler secret put RESEND_API_KEY --name the1500-staging
```
```bash
npx wrangler secret put STRIPE_SECRET_KEY --name the1500-staging
```
```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --name the1500-staging
```
```bash
npx wrangler secret put AI_API_KEY --name the1500-staging
```

El código rechaza `sk_live_` y `rk_live_` aunque alguien las configure: responde `LIVE_PAYMENTS_NOT_AUTHORIZED`.

## Variables no secretas (`wrangler.jsonc`, sección `vars`)

Deben estar en el archivo: `wrangler deploy` sobrescribe las que se cambien en el panel.

| Variable | Valor | Cuándo |
|---|---|---|
| `MAIL_FROM` | `THE1500 <signin@dominio-verificado>` | Al verificar un dominio en Resend. Es lo único que falta decidir para el correo |
| `PAYMENTS_ENABLED` | `"true"` | Solo cuando las dos claves de Stripe de prueba estén puestas |
| `AI_MODEL` | Opcional. Por defecto `claude-opus-5-5` | |

No definir en staging `RESEND_API_BASE`, `STRIPE_API_BASE` ni `AI_BASE_URL`: existen solo para los simuladores locales.

## Webhook de Stripe (modo Test)

URL: `https://the1500-staging.admonpalmerafood.workers.dev/api/v1/webhooks/stripe`

Eventos: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.

## Qué queda por verificar al tener las claves

1. Correo: un enlace mágico real de ida y vuelta.
2. Stripe: reserva, Checkout con tarjeta de prueba, webhook real, reembolso, y un pago tardío para confirmar `paidAtSource: provider_charge`. La versión de API fijada en `src/core/stripe.ts` debe coincidir con la cuenta.
3. LLM: generar perfiles reales y calibrar los controles heurísticos de `src/core/claims.ts`.

La entidad vendedora sigue sin definir. Es configuración (`POST /admin/seller`), ningún nombre está en el código, y definirla no habilita cobros reales.
