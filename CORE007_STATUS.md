# CORE-007 — Correo transaccional

**Fecha:** 2026-11-04 · **Decisión del propietario:** Cloudflare Email Sending como proveedor principal, Resend como respaldo. **Pasos:** `docs/SECRETS_AND_INTEGRATIONS.md` §1.

> Stripe y el LLM siguen en pausa. **Todavía no se ha enviado ningún correo real.**

| Elemento | Estado | Notas |
|---|---|---|
| Adaptador independiente del proveedor (`src/core/mail.ts`) | DONE | Se elige con `MAIL_PROVIDER`. Sin cambio automático entre proveedores, para no duplicar envíos |
| Adaptador de Cloudflare | DONE (local) | Probado con un doble y con el simulador local de Workers. Fallos conforme a los códigos documentados |
| Adaptador de Resend | DONE (local) | Conservado, sin activar |
| Flujos de acceso y notificaciones | DONE (local) | Sin cambios funcionales salvo los descritos abajo |
| Binding y migración 0008 en staging | DONE | Sin remitente: el acceso sigue respondiendo 503 |
| Envío y recepción reales | BLOCKED | Faltan Workers Paid y un dominio en Cloudflare DNS |
| SPF, DKIM y DMARC reales | BLOCKED | Mismo motivo |
| Enlace de un solo uso con correo real | BLOCKED | Sí probado por HTTP en D1 remoto con enlace sembrado (CORE-006) |
| Registro de rebotes | NOT_STARTED | Ver abajo |

## Comportamiento nuevo

- **Dirección rechazada en el acceso** (por ejemplo, suprimida tras un rebote): misma respuesta de siempre, para no revelar direcciones; sin token, y con incidencia `login_mail_rejected` para administración.
- **Proveedor bloqueado** (cupo agotado o remitente sin verificar): la cola espera sin gastar intentos, con una incidencia crítica `mail_provider_blocked` al día. El acceso responde 503.
- **Notificación rechazada:** falla de inmediato con su motivo e incidencia `notification_failed`.
- **Trazabilidad:** cada notificación guarda proveedor, id del mensaje y motivo de fallo.

## Limitaciones

1. **"Enviado" significa aceptado por el proveedor, no entregado.** El plazo de 15 días de reactivación arranca en ese momento, y un rebote posterior hoy no se detecta. Cloudflare publica estos eventos por Queues; se conectará cuando pueda probarse con envíos reales.
2. **Solo texto.** Cloudflare recomienda incluir también HTML por entregabilidad. Se decidirá con los resultados de la prueba real.
3. **Cupo inicial sin cifra publicada**, y Sending sigue en beta.
4. **Wrangler no pudo listar dominios de envío** (`Unauthorized`, código 2036), así que el estado real de la cuenta sigue sin comprobar.

## Comprobación sin coste (2026-11-04)

El propietario no autoriza por ahora Workers Paid. No se creó ni modificó nada en Cloudflare.

| Comprobación | Resultado |
|---|---|
| Dominios con Email Routing en la cuenta | Ninguno (`wrangler email routing list`) |
| Direcciones de destino verificadas | Ninguna (`wrangler email routing addresses list`) |
| Dominios de Email Sending | Sin dato: la API responde `Unauthorized` (2036) |
| Envío real hoy | **No es posible**: la dirección del remitente debe pertenecer a un dominio incorporado, y no hay ninguno utilizable |
| Registro de `the1500.com` y `the1500.net` | Sin registro en Verisign (2026-11-04). No garantiza disponibilidad y no sustituye la revisión de marca (B02) |

**La documentación de Cloudflare no es concluyente sobre el plan gratuito.** Por un lado: enviar a direcciones verificadas es gratis en todos los planes, "including when only Email Routing is configured". Por otro: la tabla de precios marca el envío saliente como "Not available" en Workers Free, y el remitente debe pertenecer a un dominio incorporado. Solo un envío real lo resuelve.

Esa prueba gratuita, aunque pase, validaría el adaptador y el enlace de un solo uso hacia direcciones verificadas. No validaría el envío a clientes, que exige Workers Paid.

## Decisión de infraestructura (2026-11-04)

THE1500 operará en una cuenta de Cloudflare independiente, confirmado por el propietario. Dominio preferido: `the1500.com`, sin comprar. Revisión: `docs/DOMAIN_REVIEW_2026-11-04.md`. Traslado preparado, sin ejecutar: `docs/STAGING_MIGRATION.md`. El staging actual se conserva hasta entonces.

