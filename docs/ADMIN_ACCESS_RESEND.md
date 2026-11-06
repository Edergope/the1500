# THE1500: acceso del propietario con correo transitorio (Resend)

**Para qué:** que entres en staging con tu correo real sin haber comprado `the1500.com`. Cuando exista el dominio, este remitente se sustituye por uno propio.

## Cómo funciona y sus límites

Staging envía con Resend desde su remitente de pruebas, `THE1500 <onboarding@resend.dev>` (`wrangler.jsonc`, `MAIL_PROVIDER=resend`).

**Lo que dice Resend en su documentación oficial (consultada el 6-11-2026):**
- **Destinatarios:** sin dominio verificado, el remitente de pruebas solo entrega a la dirección dueña de la cuenta de Resend. Cualquier otra recibe el error 403 `validation_error`: «You can only send testing emails to your own email address» ([guía de configuración](https://resend.com/setup.md), [errores](https://resend.com/docs/api-reference/errors.md)).
- **Plan gratuito:** 100 correos al día y 3.000 al mes, con un límite de 10 solicitudes por segundo ([cuotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits.md)).

**Consecuencias en staging:**
- Solo tu dirección (la de la cuenta de Resend) recibe correo. Los titulares demo no; siguen entrando con `scripts/demo.cjs link`.
- Para otra dirección, THE1500 registra un rechazo de ese destinatario: el formulario de acceso da la respuesta uniforme y queda una incidencia `login_mail_rejected`. Nunca se presenta como entregado.
- La reautenticación del panel de integraciones también llega solo a tu correo. El administrador demo no puede reautenticarse, así que en staging no podrá hacer cambios críticos.
- El remitente compartido de Resend no sirve para producción.

## Lo que haces tú

**1. Crea la cuenta de Resend con tu correo real** en https://resend.com. Usa el mismo correo con el que entrarás en THE1500.

**2. Crea una clave de API** en *API Keys* con permiso **Sending access**.

**3. Guárdala como secreto de staging.** Abre una terminal en la carpeta del repositorio y ejecuta:

```bash
npx wrangler secret put RESEND_API_KEY
```

- Pega la clave cuando la pida. No la escribas en el chat ni en ningún archivo.
- El comando crea una versión nueva del Worker con el secreto. No cambia nada más.

**4. Avísame en el chat** solo con «clave de Resend configurada».

## Lo que sigue después, paso a paso

| Paso | Quién | Qué |
|---|---|---|
| 1 | Claude | Comprueba que existe el secreto `RESEND_API_KEY`, sin leer su valor |
| 2 | Tú | Entras en `/es/login` con tu correo, recibes el enlace y pulsas «Confirmar acceso». Así se prueban el envío y la recepción reales y queda un `login_completed` |
| 3 | Claude | `node scripts/superadmin.cjs prepare <tu correo> --target staging`: muestra tu identificador de usuario y la hora del acceso. Solo lee |
| 4 | Tú | Confirmas en el chat que la cuenta y la hora son tuyas y **autorizas expresamente** la elevación |
| 5 | Claude | `grant`, antes de una hora desde el paso 2, citando tu autorización. Queda en `admin_events` |
| 6 | Tú | Abres `/es/admin` y compruebas que ves el panel |
| 7 | Tú | **Autorizas expresamente** la retirada del administrador demo |
| 8 | Claude | `revoke-demo` y después `verify`, que falla si queda cualquier administrador que no seas tú |

Ningún paso de elevación o revocación se ejecuta sin tu autorización escrita en el chat.

## Después del dominio propio

1. Verificar `the1500.com` en Resend (o en Cloudflare Email Sending).
2. Cambiar `MAIL_FROM` a una dirección de ese dominio.
3. Probar el envío desde `/es/admin/integraciones`.

A partir de ahí los titulares reciben su correo.
